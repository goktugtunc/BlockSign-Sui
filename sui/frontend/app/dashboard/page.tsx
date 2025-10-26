// app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { WalletGuard } from "@/components/wallet-guard";
import {
  FileText,
  Users,
  Clock,
  CheckCircle,
  Upload,
  Eye,
  Share,
  Copy,
  MoreHorizontal,
  PenTool,
  X,
  Bot,
  Plus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/language-context";
import { useTranslation } from "@/lib/i18n";

// Sui dApp Kit + SDK
import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";

// ---- Sözleşme sabitleri (testnet) ----
const PACKAGE = "0xd11a3b8c098894ffa2c286d53897bbb13358c52426ae024e2b7b871cce149280";
const TREASURY = "0x3f3628c00211ce0e98a1176abd85119a12dc7b76d131eb483fa63041c985dfa5"; // shared
const REGISTRY = "0x682e4de22a8e031fff935f0e895b233c45e22f1771c612b459f43b9a19ed498d"; // shared
const TYPE_CREATED = `${PACKAGE}::contract::CreatedEvent`;
const TYPE_SIGNED = `${PACKAGE}::contract::SignedEvent`;
const TYPE_REJECTED = `${PACKAGE}::contract::RejectedEvent`;
const TYPE_CANCELED = `${PACKAGE}::contract::CanceledEvent`;

// ---- Yardımcılar ----
function shortAddr(a: string) {
  if (!a) return "";
  const s = a.toLowerCase();
  return `0x${s.slice(2, 6)}...${s.slice(-4)}`;
}

type DocRow = {
  id: string;                // Document object id
  title: string;             // (UI için uydurma; IPFS başlığı yoksa addr kısa gösteriyoruz)
  owner: string;
  parties: string[];
  createdTs: number | null;  // event timestamp (ms)
  ipfsHash?: string;         // (opsiyonel; şimdilik boş)
  txId?: string;             // (opsiyonel; şimdilik boş)
  status: "Completed" | "Waiting" | "Draft" | "Rejected" | "Canceled";
  signedCount: number;
  totalSigners: number;
};

export default function DashboardPage() {
  const { toast } = useToast();
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const account = useCurrentAccount();
  const sui = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<{ id: string; title: string } | null>(null);

  // Zincirden gelen veriler
  const [uploaded, setUploaded] = useState<DocRow[]>([]);
  const [signedByMe, setSignedByMe] = useState<DocRow[]>([]);
  const [requests, setRequests] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Stats
  const stats = useMemo(() => {
    const uploadedCnt = uploaded.length;
    const signedCnt = signedByMe.filter((r) => r.status !== "Rejected" && r.status !== "Canceled").length;
    const pendingReq = requests.filter((r) => r.status === "Waiting").length;
    return {
      uploaded: uploadedCnt,
      signed: signedCnt,
      pendingRequests: pendingReq,
      avgTurnaround: "-", // zincirde ölçmek için ayrı metrik gerekir
    };
  }, [uploaded, signedByMe, requests]);

  // ---- Zincirden data çek ----
  useEffect(() => {
    (async () => {
      if (!account?.address) {
        setUploaded([]);
        setSignedByMe([]);
        setRequests([]);
        return;
      }
      try {
        setLoading(true);

        // 1) Benim oluşturduklarım → CreatedEvent.owner = myAddress
        const createdEv = await sui.queryEvents({
          query: { MoveEventType: TYPE_CREATED },
          limit: 200,
          order: "descending",
        });

        // 2) Benim imzaladıklarım → SignedEvent.signer = myAddress
        const signedEv = await sui.queryEvents({
          query: { MoveEventType: TYPE_SIGNED },
          limit: 200,
          order: "descending",
        });

        const myAddr = account.address.toLowerCase();

        // Helper: Document oku ve UI'ye çevir
        async function toDocRow(docId: string, createdAtMs: number | null): Promise<DocRow | null> {
          const o = await sui.getObject({
            id: docId,
            options: { showContent: true },
          });
          const fields = (o.data?.content as any)?.fields;
          if (!fields) return null;

          const owner = String(fields.owner).toLowerCase();
          const signers: string[] = (fields.signers || []).map((s: string) => s.toLowerCase());
          const signed: string[] = (fields.signed || []).map((s: string) => s.toLowerCase());
          const canceled: boolean = !!fields.canceled;

          let status: DocRow["status"] = "Draft";
          if (canceled) status = "Canceled";
          else if (signers.length > 0 && signers.every((s) => signed.includes(s))) status = "Completed";
          else if (signed.length > 0) status = "Waiting";
          else status = "Draft";

          return {
            id: docId,
            title: `Sözleşme (${shortAddr(docId)})`,
            owner,
            parties: signers,
            createdTs: createdAtMs,
            ipfsHash: "", // IPFS CID'i zincirde saklamıyorsan şimdilik boş
            txId: "",     // Sonraki sürümde event digest ile doldurabilirsin
            status,
            signedCount: signed.length,
            totalSigners: signers.length,
          };
        }

        // ---- Uploaded (benim oluşturduklarım) ----
        const uploadedRows: DocRow[] = [];
        for (const ev of createdEv.data) {
          const pj = (ev.parsedJson as any) || {};
          const owner = String(pj.owner || "").toLowerCase();
          const docId = String(pj.doc || pj.id || "");
          if (!docId) continue;
          if (owner !== myAddr) continue;

          const ts = ev.timestampMs ? Number(ev.timestampMs) : null;
          const row = await toDocRow(docId, ts);
          if (row) uploadedRows.push(row);
        }

        // ---- Signed by me (benim imzaladıklarım) ----
        const signedRows: DocRow[] = [];
        for (const ev of signedEv.data) {
          const pj = (ev.parsedJson as any) || {};
          const signer = String(pj.signer || "").toLowerCase();
          const docId = String(pj.doc || "");
          if (!docId) continue;
          if (signer !== myAddr) continue;

          const ts = ev.timestampMs ? Number(ev.timestampMs) : null;
          const row = await toDocRow(docId, ts);
          if (row) signedRows.push(row);
        }

        // ---- Requests (ben imzacı listesinde olup henüz imzalamadığım & owner != me) ----
        // Bunun için uploadedRows + createdEv'den tüm doc'ları çekip filtreleyeceğiz.
        const allDocsSet = new Set<string>();
        for (const ev of createdEv.data) {
          const pj = (ev.parsedJson as any) || {};
          const docId = String(pj.doc || "");
          if (docId) allDocsSet.add(docId);
        }
        
        const reqRows: DocRow[] = [];
        for (const docId of allDocsSet) {
          // Dokümanı satıra çevir
          const tsEv = createdEv.data.find((e) => String((e.parsedJson as any)?.doc || "") === docId);
          const ts = tsEv?.timestampMs ? Number(tsEv.timestampMs) : null;
          const row = await toDocRow(docId, ts);
          if (!row) continue;
        
          const iAmSigner = row.parties.includes(myAddr);
          const iAmOwner = row.owner === myAddr;
        
          // Ben zaten imzaladım mı? (signed vektöründe adresim var mı?)
          let meSigned = false;
          try {
            const o = await sui.getObject({ id: docId, options: { showContent: true } });
            const signedVec: string[] = (((o.data?.content as any)?.fields?.signed) || []).map((s: string) =>
              s.toLowerCase(),
            );
            meSigned = signedVec.includes(myAddr);
          } catch {
            meSigned = false;
          }
        
          // Request kriteri:
          if (iAmSigner && !iAmOwner && !meSigned && row.status !== "Canceled" && row.status !== "Completed") {
            reqRows.push(row);
          }
        }

        setUploaded(uploadedRows);
        setSignedByMe(signedRows);
        setRequests(reqRows);
      } catch (e: any) {
        console.error(e);
        toast({ title: "Zincir okuma hatası", description: e?.message || String(e), variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [account?.address, sui, toast]);

  // ---- UI: panodaki yardımcılar ----
  const { copied, onCopy } = useMemo(() => {
    let copied = false;
    return {
      copied,
      onCopy: (text: string, type: string) => {
        navigator.clipboard.writeText(text);
        copied = true;
        toast({ title: "Kopyalandı", description: `${type} panoya kopyalandı.` });
      },
    };
  }, [toast]);

  const getStatusBadge = (status: DocRow["status"]) => {
    switch (status) {
      case "Completed":
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Tamamlandı</Badge>;
      case "Waiting":
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Bekliyor</Badge>;
      case "Draft":
        return <Badge variant="secondary">Taslak</Badge>;
      case "Rejected":
        return <Badge variant="destructive">Reddedildi</Badge>;
      case "Canceled":
        return <Badge variant="destructive">İptal</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // ---- İşlemler: sign() ve reject() ----
  async function signDocument(docId: string) {
    if (!account?.address) return;
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE}::contract::sign`,
      arguments: [tx.object(docId)],
    });

    const out = await signAndExecute({
      transaction: tx,
      chain: "sui:testnet",
    });

    toast({ title: "İmza gönderildi", description: `Digest: ${out.digest}` });
  }

  async function rejectDocument(docId: string) {
    if (!account?.address) return;
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE}::contract::reject`,
      arguments: [tx.object(docId)],
    });

    const out = await signAndExecute({
      transaction: tx,
      chain: "sui:testnet",
    });

    toast({ title: "Reddetme gönderildi", description: `Digest: ${out.digest}` });
  }

  const handleSign = async (docId: string) => {
    try {
      await signDocument(docId);
    } catch (e: any) {
      toast({ title: "İmza hatası", description: e?.message || String(e), variant: "destructive" });
    }
  };

  const handleDecline = async () => {
    if (!selectedRequest) return;
    try {
      await rejectDocument(selectedRequest.id);
      setDeclineDialogOpen(false);
      setDeclineReason("");
      setSelectedRequest(null);
    } catch (e: any) {
      toast({ title: "Reddetme hatası", description: e?.message || String(e), variant: "destructive" });
    }
  };

  // ---- Render ----
  return (
    <WalletGuard title="Cüzdan gerekli" description="Paneli görmek için Sui cüzdanınızı bağlayın.">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Panel</h1>
          <p className="text-muted-foreground">Sözleşmelerini görüntüle, imzala ve yönet.</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Yüklenen</CardTitle>
              <Upload className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.uploaded}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">İmzalanan</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.signed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Bekleyen İstek</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.pendingRequests}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Ortalama Süre</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.avgTurnaround}</div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="uploaded" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="uploaded">Yüklenen</TabsTrigger>
            <TabsTrigger value="signed">İmzaladıklarım</TabsTrigger>
            <TabsTrigger value="requests">İmza İstekleri</TabsTrigger>
          </TabsList>

          {/* Uploaded */}
          <TabsContent value="uploaded" className="space-y-4">
            {uploaded.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Yüklenen Sözleşmeler</CardTitle>
                  <CardDescription>Senin oluşturduğun sözleşmeler</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Başlık</TableHead>
                        <TableHead>Taraflar</TableHead>
                        <TableHead>Durum</TableHead>
                        <TableHead>Oluşturma</TableHead>
                        <TableHead>IPFS</TableHead>
                        <TableHead>TxID</TableHead>
                        <TableHead className="text-right">Aksiyon</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uploaded.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.title}</TableCell>
                          <TableCell>
                            <div className="flex -space-x-2">
                              {c.parties.map((p, i) => (
                                <Avatar key={i} className="w-6 h-6 border-2 border-background">
                                  <AvatarFallback className="text-[10px]">{shortAddr(p)}</AvatarFallback>
                                </Avatar>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>{getStatusBadge(c.status)}</TableCell>
                          <TableCell>{c.createdTs ? new Date(c.createdTs).toLocaleString() : "-"}</TableCell>
                          <TableCell>
                            {c.ipfsHash ? (
                              <Button variant="ghost" size="sm" onClick={() => onCopy(c.ipfsHash!, "IPFS Hash")}>
                                {c.ipfsHash}
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {c.txId ? (
                              <Button variant="ghost" size="sm" onClick={() => onCopy(c.txId!, "Transaction ID")}>
                                {c.txId}
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/contracts/${c.id}`}>
                                    <Eye className="mr-2 h-4 w-4" />
                                    Görüntüle
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <Share className="mr-2 h-4 w-4" />
                                  Paylaş
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onCopy(c.id, "Document ID")}>
                                  <Copy className="mr-2 h-4 w-4" />
                                  Doc ID kopyala
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <Card className="text-center py-12">
                <CardContent>
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Yüklenmiş sözleşme yok</h3>
                  <p className="text-muted-foreground mb-4">İlk sözleşmeni oluştur ve imzaya gönder</p>
                  <Link href="/create">
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      İlk sözleşmeni oluştur
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Signed by me */}
          <TabsContent value="signed" className="space-y-4">
            {signedByMe.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>İmzaladıklarım</CardTitle>
                  <CardDescription>İmzaladığın sözleşmeler</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Başlık</TableHead>
                        <TableHead>Sahip</TableHead>
                        <TableHead>Durum</TableHead>
                        <TableHead>İmzalayan / Tüm</TableHead>
                        <TableHead className="text-right">Aksiyon</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {signedByMe.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.title}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{shortAddr(c.owner)}</Badge>
                          </TableCell>
                          <TableCell>{getStatusBadge(c.status)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {c.signedCount}/{c.totalSigners}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/contracts/${c.id}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <Card className="text-center py-12">
                <CardContent>
                  <PenTool className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">İmzalanmış sözleşme yok</h3>
                  <p className="text-muted-foreground">Davet edildiğinde burada görünecek.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Signature Requests */}
          <TabsContent value="requests" className="space-y-4">
            {requests.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>İmza İstekleri</CardTitle>
                  <CardDescription>Senin imzan beklenen sözleşmeler</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {requests.map((r) => (
                      <Card key={r.id} className="border-2">
                        <CardContent className="pt-6">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="font-semibold">{r.title}</h3>
                                <Badge variant="secondary">Bekliyor</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mb-2">
                                Sahip: <Badge variant="outline">{shortAddr(r.owner)}</Badge>
                              </p>
                              <p className="text-sm text-muted-foreground mb-3">
                                {r.createdTs ? new Date(r.createdTs).toLocaleString() : "-"}
                              </p>
                              <div className="bg-muted/50 rounded-lg p-3 mb-4">
                                <div className="flex items-center gap-2 mb-2">
                                  <Bot className="h-4 w-4 text-emerald-500" />
                                  <span className="text-sm font-medium">Özet</span>
                                </div>
                                <p className="text-sm">
                                  Bu sözleşme için imzan bekleniyor. İnceledikten sonra imzalayabilir veya
                                  reddedebilirsin.
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/contracts/${r.id}`}>
                                <Eye className="mr-2 h-4 w-4" />
                                Önizleme
                              </Link>
                            </Button>
                            <Button
                              size="sm"
                              className="bg-emerald-500 hover:bg-emerald-600"
                              onClick={() => handleSign(r.id)}
                            >
                              <PenTool className="mr-2 h-4 w-4" />
                              İmzala
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setSelectedRequest({ id: r.id, title: r.title });
                                setDeclineDialogOpen(true);
                              }}
                            >
                              <X className="mr-2 h-4 w-4" />
                              Reddet
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="text-center py-12">
                <CardContent>
                  <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Bekleyen istek yok</h3>
                  <p className="text-muted-foreground">Davet alırsan burada görünecek.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Decline Dialog */}
        <Dialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>İmzalamayı reddet</DialogTitle>
              <DialogDescription>İstersen bir gerekçe bırakabilirsin (zincire yazılmaz).</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Textarea
                placeholder="Reddetme sebebi..."
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeclineDialogOpen(false)}>
                İptal
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  await handleDecline();
                }}
              >
                Reddet
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </WalletGuard>
  );
}
