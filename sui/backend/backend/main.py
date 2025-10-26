# app.py
# FastAPI backend for Sui "blocksign" — no uploads, no .env
# - Testnet constants are hard-coded (PACKAGE_ID / TREASURY_ID / REGISTRY_ID)
# - Single-call flow supported: build-only OR build + execute (returns doc_id)
# - Read endpoints (gasless): isactive / issign / iscomplete
# - Helpers to extract Document IDs from a tx digest

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Tuple, Optional
import requests

# =========================================================
# App & CORS
# =========================================================
app = FastAPI(title="Sui Blocksign Bridge (testnet)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8084",
        "http://localhost:3001",
        "http://sui.hackstack.com.tr",
        "https://sui.hackstack.com.tr",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"ok": True, "msg": "Sui testnet blocksign bridge"}

# =========================================================
# Sui constants (TESTNET) — NO .env
# =========================================================
SUI_RPC     = "https://fullnode.testnet.sui.io:443"
PACKAGE_ID  = "0xd11a3b8c098894ffa2c286d53897bbb13358c52426ae024e2b7b871cce149280"
TREASURY_ID = "0x3f3628c00211ce0e98a1176abd85119a12dc7b76d131eb483fa63041c985dfa5"  # Shared
REGISTRY_ID = "0x682e4de22a8e031fff935f0e895b233c45e22f1771c612b459f43b9a19ed498d"  # Shared

FEE_MIST    = 2_000_000  # 0.002 SUI

def _assert_hex_id(name: str, val: str):
    if not isinstance(val, str) or not val.startswith("0x"):
        raise HTTPException(500, detail=f"{name} must be a hex id starting with 0x")

_assert_hex_id("PACKAGE_ID", PACKAGE_ID)
_assert_hex_id("TREASURY_ID", TREASURY_ID)
_assert_hex_id("REGISTRY_ID", REGISTRY_ID)

# =========================================================
# Helpers & RPC
# =========================================================
def _hexstr(h: str) -> str:
    return h[2:] if isinstance(h, str) and h.startswith("0x") else h

def _ensure_32bytes_hex(h: str) -> str:
    if not isinstance(h, str):
        raise HTTPException(400, detail="file_hash_hex must be string")
    hx = _hexstr(h.strip().lower())
    if len(hx) != 64:
        raise HTTPException(400, detail="file_hash_hex must be 32 bytes (64 hex chars)")
    try:
        int(hx, 16)
    except ValueError:
        raise HTTPException(400, detail="file_hash_hex is not valid hex")
    return "0x" + hx

def _addr(a: str) -> str:
    if not isinstance(a, str):
        return ""
    a = a.strip().lower()
    return a if a.startswith("0x") else ("0x" + a)

def sui_rpc(method: str, params: List[Any]) -> Any:
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    try:
        r = requests.post(SUI_RPC, json=body, timeout=30)
    except requests.RequestException as e:
        raise HTTPException(502, detail=f"Sui RPC request failed: {e}")
    if r.status_code != 200:
        raise HTTPException(502, detail=f"Sui RPC HTTP {r.status_code}")
    out = r.json()
    if "error" in out:
        # Sui returns {"error":{"code":..,"message":..}}
        raise HTTPException(400, detail=out["error"])
    return out.get("result")

def _pick_content_from_getobject(res: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    data = (res.get("data") or res.get("object") or res.get("details") or {})
    content = data.get("content") or {}
    return data, content

def _doc_ids_from_object_changes(changes: Optional[List[Dict[str, Any]]]) -> List[str]:
    if not changes:
        return []
    out: List[str] = []
    for c in changes:
        if isinstance(c, dict) and c.get("type") == "created":
            typ = c.get("objectType")
            if isinstance(typ, str) and typ.endswith("::contract::Document"):
                oid = c.get("objectId")
                if isinstance(oid, str):
                    out.append(oid)
    return out

def _get_document(doc_id: str) -> Dict[str, Any]:
    oid = _addr(doc_id)
    # correct parameter shape: [objectId, options]
    res = sui_rpc("sui_getObject", [oid, {"showContent": True}])
    data, content = _pick_content_from_getobject(res)
    if not data:
        raise HTTPException(404, detail={"msg": "Document not found (no data)", "object_id": oid})
    if content.get("dataType") != "moveObject" or "fields" not in content:
        raise HTTPException(404, detail={"msg": "Not a moveObject or no fields", "object_id": oid})
    fields = content.get("fields") or {}
    return {
        "doc_id": _addr(fields.get("doc_id") or oid),
        "owner": _addr(fields.get("owner", "")),
        "file_hash": fields.get("file_hash"),
        "signers": [_addr(x) for x in (fields.get("signers") or [])],
        "signed":  [_addr(x) for x in (fields.get("signed")  or [])],
        "canceled": bool(fields.get("canceled", False)),
    }

def _get_tx_with_changes(digest: str) -> Dict[str, Any]:
    # Prefer modern method; fall back to suix_* if needed.
    try:
        return sui_rpc("sui_getTransactionBlock", [digest, {"showObjectChanges": True, "showEvents": True, "showEffects": True}])
    except HTTPException:
        return sui_rpc("suix_getTransactionBlock", [digest, {"showObjectChanges": True, "showEvents": True, "showEffects": True}])

# =========================================================
# Pydantic models
# =========================================================
class CreateBuildRequest(BaseModel):
    sender: str
    file_hash_hex: str
    signers: List[str]

class PayCoin(BaseModel):
    object_id: str  # Coin<SUI> (owned, must NOT be the same coin used for gas)

class ExecutePayload(BaseModel):
    """
    Optional — send signed tx to execute in the same request:
      - tx_bytes (base64)
      - signatures: [base64, ...]
    """
    tx_bytes: Optional[str] = Field(None, description="Base64-encoded bcs transaction bytes")
    signatures: Optional[List[str]] = Field(None, description="Base64-encoded signature list")

class CreateBuildAndMaybeExecute(BaseModel):
    req: CreateBuildRequest
    pay: PayCoin
    execute: Optional[ExecutePayload] = None

class SignBuildRequest(BaseModel):
    sender: str
    document_id: str

class IdOnly(BaseModel):
    document_id: str

class IsActiveReadRequest(BaseModel):
    document_id: str

class IsSignReadRequest(BaseModel):
    document_id: str
    address: str

class IsCompleteReadRequest(BaseModel):
    document_id: str

class TxDigest(BaseModel):
    digest: str

# =========================================================
# Build (+ optional execute) — SINGLE ENDPOINT
# =========================================================
@app.post("/sui/create/build")
def sui_create_build(body: CreateBuildAndMaybeExecute):
    """
    - If execute is NOT provided: returns a moveCall recipe (build-only).
    - If execute.tx_bytes + execute.signatures are provided: publishes to chain and
      returns digest + created Document IDs in the SAME response.
    """
    file_hash_hex = _ensure_32bytes_hex(body.req.file_hash_hex)

    move_call = {
        "tx_kind": "moveCall",
        "package": PACKAGE_ID,
        "module": "contract",
        "function": "create_contract",
        "arguments": {
            "treasury": TREASURY_ID,
            "registry": REGISTRY_ID,
            "file_hash": file_hash_hex,
            "signers": [_addr(s) for s in body.req.signers],
            "payment_coin": _addr(body.pay.object_id),
            "fee_mist": FEE_MIST
        },
        "note": "tx.moveCall({target:`{package}::contract::create_contract`, args:[obj(TREASURY), obj(REGISTRY), pure(file_hash_bytes), pure(signers), obj(payment_coin)]})"
    }

    # Build-only
    if not body.execute or not body.execute.tx_bytes or not body.execute.signatures:
        return move_call

    # Build + Execute (single call)
    exec_opts = {
        "showInput": False,
        "showRawInput": False,
        "showEffects": True,
        "showEvents": True,
        "showObjectChanges": True,
        "showBalanceChanges": False
    }
    res = sui_rpc("sui_executeTransactionBlock", [
        body.execute.tx_bytes,
        body.execute.signatures,
        exec_opts,
        "WaitForLocalExecution"
    ])

    digest = res.get("digest")
    changes = res.get("objectChanges") or []
    doc_ids = _doc_ids_from_object_changes(changes)

    return {
        "executed": True,
        "digest": digest,
        "document_ids": doc_ids,
        "tx_result": {
            "effectsStatus": (res.get("effects") or {}).get("status", {}).get("status"),
            "objectChangesCount": len(changes)
        },
        "build_echo": move_call  # keep for debug; remove if you prefer a minimal response
    }

# =========================================================
# Transaction helpers — digest → doc_id(s)
# =========================================================
@app.post("/sui/tx/doc-ids")
def tx_doc_ids(req: TxDigest):
    tx = _get_tx_with_changes(req.digest)
    docs = _doc_ids_from_object_changes(tx.get("objectChanges") or [])
    return {"document_ids": docs}

@app.post("/sui/tx/doc-id")
def tx_doc_id(req: TxDigest):
    resp = tx_doc_ids(req)
    docs = resp["document_ids"]
    if not docs:
        raise HTTPException(404, detail="No Document created in this transaction.")
    if len(docs) > 1:
        return {"document_id": docs[0], "count": len(docs)}
    return {"document_id": docs[0]}

# =========================================================
# Build stubs for other actions (frontend signs)
# =========================================================
@app.post("/sui/sign/build")
def sui_build_sign(req: SignBuildRequest):
    return {
        "tx_kind": "moveCall",
        "package": PACKAGE_ID,
        "module": "contract",
        "function": "sign",
        "arguments": {"document": _addr(req.document_id)},
        "note": "tx.moveCall({target:`{package}::contract::sign`, args:[obj(document)]})"
    }

@app.post("/sui/issign/build")
def sui_build_issign(req: IdOnly):
    return {
        "tx_kind": "moveCall",
        "package": PACKAGE_ID,
        "module": "contract",
        "function": "issign",
        "arguments": {"document": _addr(req.document_id)},
        "note": "For gasless check use /sui/read/issign."
    }

@app.post("/sui/iscomplete/build")
def sui_build_iscomplete(req: IdOnly):
    return {
        "tx_kind": "moveCall",
        "package": PACKAGE_ID,
        "module": "contract",
        "function": "iscomplete",
        "arguments": {"document": _addr(req.document_id)},
        "note": "For gasless check use /sui/read/iscomplete."
    }

@app.post("/sui/reject/build")
def sui_build_reject(req: IdOnly):
    return {
        "tx_kind": "moveCall",
        "package": PACKAGE_ID,
        "module": "contract",
        "function": "reject",
        "arguments": {"document": _addr(req.document_id)}
    }

@app.post("/sui/cancel/build")
def sui_build_cancel(req: IdOnly):
    return {
        "tx_kind": "moveCall",
        "package": PACKAGE_ID,
        "module": "contract",
        "function": "cancel",
        "arguments": {"document": _addr(req.document_id)}
    }

# =========================================================
# Read-only (gasless) endpoints
# =========================================================
@app.post("/sui/read/isactive")
def read_isactive(req: IsActiveReadRequest):
    d = _get_document(req.document_id)
    return {"is_active": 0 if d["canceled"] else 1}

@app.post("/sui/read/issign")
def read_issign(req: IsSignReadRequest):
    d = _get_document(req.document_id)
    who = _addr(req.address)
    if not who or who == "0x":
        raise HTTPException(400, detail="Invalid address")
    return {"issign": 1 if who in set(d["signed"]) else 0}

@app.post("/sui/read/iscomplete")
def read_iscomplete(req: IsCompleteReadRequest):
    d = _get_document(req.document_id)
    if d["canceled"]:
        return {"iscomplete": 0, "reason": "canceled", "total_signers": len(d["signers"]), "signed_count": len(d["signed"])}
    ok = 1 if (len(d["signers"]) > 0 and set(d["signers"]).issubset(set(d["signed"]))) else 0
    return {"iscomplete": ok, "total_signers": len(d["signers"]), "signed_count": len(d["signed"])}
