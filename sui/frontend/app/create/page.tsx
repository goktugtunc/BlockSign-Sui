// app/create/page.tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, FileText, Loader2, CheckCircle, AlertTriangle, Upload, Plus, X, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { WalletGuard } from "@/components/wallet-guard";
import { useWallet } from "@/lib/wallet-context";
import { generateContract } from "@/lib/gemini";
import { exportToPDF } from "@/lib/pdf-utils";

// ---- SUI SDK (yeni yollar) ----
import { Transaction } from "@mysten/sui/transactions";
import { fromHEX } from "@mysten/sui/utils";
import { useSignTransaction } from "@mysten/dapp-kit";
// ---- Config (SUI) ----
const BACKEND_BASE = "https://suiback.hackstack.com.tr"; // SUI backend
const PACKAGE = "0xd11a3b8c098894ffa2c286d53897bbb13358c52426ae024e2b7b871cce149280";
const TREASURY = "0x3f3628c00211ce0e98a1176abd85119a12dc7b76d131eb483fa63041c985dfa5"; // shared
const REGISTRY = "0x682e4de22a8e031fff935f0e895b233c45e22f1771c612b459f43b9a19ed498d"; // shared

export default function CreateContractPage() {
  const { toast } = useToast();
  const { wallet } = useWallet();

  // dApp Kit: yalnız imzalama (execute yok)
  const { mutateAsync: signTransaction } = useSignTransaction();

  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContract, setGeneratedContract] = useState<any>(null);

  const steps = [
    { title: "Taslak", description: "AI ile oluştur", icon: Bot },
    { title: "PDF", description: "Dışa aktar", icon: FileText },
    { title: "IPFS", description: "Pinata ile yükle", icon: Upload },
  ] as const;

  const [stepStatuses, setStepStatuses] = useState<Record<number, "pending" | "in-progress" | "completed" | "error">>({
    0: "pending",
    1: "pending",
    2: "pending",
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [signers, setSigners] = useState<string[]>([]);
  const [newSigner, setNewSigner] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileSha256Hex, setFileSha256Hex] = useState<string>("");
  const [lastSubmitResponse, setLastSubmitResponse] = useState<any>(null);

  // IPFS çıktıları
  const [ipfsCid, setIpfsCid] = useState<string>("");
  const [ipfsViewUrl, setIpfsViewUrl] = useState<string>("");

  const [parties, setParties] = useState([{ name: "", address: "" }]);
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("SUI");
  const [deadline, setDeadline] = useState("");
  const [termination, setTermination] = useState("");

  // Kullanıcıdan payment coin id al (Coin<SUI>)
  const [paymentCoin, setPaymentCoin] = useState<string>("");

  // --- SHA-256 helper (browser) ---
  async function sha256Hex(u8: Uint8Array): Promise<string> {
    const ab = (u8.buffer as ArrayBuffer).slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const digest = await crypto.subtle.digest("SHA-256", ab);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // --- IPFS (Pinata) upload helper ---
  async function pinataUpload(bytes: Uint8Array, filename: string, mime = "application/pdf") {
    const res = await fetch("/api/pinata", {
      method: "POST",
      headers: {
        "x-filename": filename,
        "x-mime": mime,
      },
      body: bytes, // raw bytes
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Pinata upload failed with status ${res.status}`);
    }
    // API route JSON: { ok: true, cid, viewUrl, raw }
    return { cid: data.cid as string, viewUrl: (data.viewUrl as string) || "" };
  }

  // ---- Helpers ----
  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast({ title: "Hata", description: "Lütfen sözleşme açıklaması girin", variant: "destructive" });
      return;
    }

    setIsGenerating(true);
    setStepStatuses((prev) => ({ ...prev, 0: "in-progress" }));
    try {
      const contract = await generateContract({
        prompt,
        parties,
        country,
        currency,
        deadline,
        termination,
      });

      setGeneratedContract(contract);
      setStepStatuses((prev) => ({ ...prev, 0: "completed" }));
      setCurrentStep(0);
      toast({ title: "Sözleşme Oluşturuldu", description: "AI tarafından sözleşme başarıyla oluşturuldu" });
    } catch (error: any) {
      setStepStatuses((prev) => ({ ...prev, 0: "error" }));
      toast({
        title: "Hata",
        description: error?.message || "Sözleşme oluşturulurken hata oluştu",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStepAction = async (step: number) => {
    try {
      setStepStatuses((prev) => ({ ...prev, [step]: "in-progress" }));
      switch (step) {
        case 1: {
          if (!generatedContract) throw new Error("Önce sözleşme oluşturmalısınız");
          toast({ title: "PDF Oluşturuluyor", description: "Sözleşme PDF'e dönüştürülüyor..." });

          const pdfData = await exportToPDF(generatedContract.contract, "Sözleşme");
          setPdfBytes(pdfData);

          const hashHex = await sha256Hex(pdfData);
          setFileSha256Hex(hashHex);

          setStepStatuses((prev) => ({ ...prev, [step]: "completed" }));
          setCurrentStep(1);
          toast({ title: "PDF Hazır", description: "Sözleşme PDF olarak hazırlandı" });
          break;
        }
        case 2: {
          if (!pdfBytes) throw new Error("Önce PDF oluşturmalısınız");

          toast({ title: "IPFS'e Yükleniyor", description: "Pinata ile ağ üzerine yükleniyor..." });
          const { cid, viewUrl } = await pinataUpload(pdfBytes, `contract-${Date.now()}.pdf`);
          setIpfsCid(cid);
          setIpfsViewUrl(viewUrl);

          setStepStatuses((prev) => ({ ...prev, [step]: "completed" }));
          setCurrentStep(2);

          toast({
            title: "IPFS’e Yüklendi",
            description: `CID: ${cid}`,
          });

          setInviteDialogOpen(true);
          break;
        }
      }
    } catch (error: any) {
      setStepStatuses((prev) => ({ ...prev, [step]: "error" }));
      toast({
        title: "Hata",
        description: error?.message || "İşlem sırasında hata oluştu",
        variant: "destructive",
      });
    }
  };

  // ---- Davet / İmzalama / Submit (SUI) ----
  const addSigner = () => {
    if (newSigner.trim()) {
      setSigners([...signers, newSigner.trim().toLowerCase()]);
      setNewSigner("");
    }
  };
  const removeSigner = (index: number) => setSigners(signers.filter((_, i) => i !== index));

  const handleInviteAndSign = async () => {
    try {
      if (!wallet?.isConnected || !wallet.address) throw new Error("Önce Slush ile cüzdan bağlayın.");
      if (!fileSha256Hex) throw new Error("Dosya SHA-256 hash mevcut değil. PDF üretip hash’lediniz mi?");
      if (signers.length === 0) throw new Error("En az bir imzacı ekleyin.");
      if (!paymentCoin) throw new Error("Payment coin object_id girin (Coin<SUI>).");

      // 1) Client-side Transaction (backend'in istediğiyle birebir)
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE}::contract::create_contract`,
        arguments: [
          tx.object(TREASURY),
          tx.object(REGISTRY),
        
          // vector<u8> olarak SHA-256
          tx.pure(bcs.ser("vector<u8>", fromHEX(fileSha256Hex)).toBytes()),
        
          // vector<address> olarak imzacı listesi
          tx.pure(
            bcs.ser(
              "vector<address>",
              signers.map((s) => normalizeSuiAddress(s))
            ).toBytes()
          ),
        
          // Coin<SUI> object id
          tx.object(paymentCoin),
        ],
      });
      // tx.setGasBudget(3_000_000) // istersen sabitle

      // 2) Sadece İMZALA (execute yok) → bytes + signature
      const { bytes, signature } = await signTransaction({ transaction: tx });

      // 3) Backend'e TEK istekte build+execute → doc_id aynı response'ta
      const res = await fetch(`${BACKEND_BASE}/sui/create/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          req: {
            sender: wallet.address,
            file_hash_hex: fileSha256Hex,
            signers,
          },
          pay: { object_id: paymentCoin },
          execute: { tx_bytes: bytes, signatures: [signature] },
          // IPFS metadata (opsiyonel ama faydalı)
          ipfs: ipfsCid ? { cid: ipfsCid, view_url: ipfsViewUrl } : undefined,
          note: inviteMessage || undefined,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.detail?.message || out?.detail || res.statusText);

      setLastSubmitResponse(out);
      const docs = out?.document_ids || [];
      toast({
        title: "İmzalandı ve Gönderildi",
        description: docs.length ? `Document ID: ${docs[0]}` : `Digest: ${out?.digest}`,
      });
      setInviteDialogOpen(false);
    } catch (err: any) {
      toast({
        title: "İmzalama/Gönderim Hatası",
        description: err?.message || String(err),
        variant: "destructive",
      });
    }
  };

  // ---- UI helpers ----
  const getStepIcon = (stepIndex: number) => {
    const status = stepStatuses[stepIndex];
    const StepIcon = steps[stepIndex].icon;
    if (status === "completed") return <CheckCircle className="h-5 w-5" />;
    if (status === "in-progress") return <Loader2 className="h-5 w-5 animate-spin" />;
    if (status === "error") return <AlertTriangle className="h-5 w-5" />;
    return <StepIcon className="h-5 w-5" />;
  };
  const getStepColor = (stepIndex: number) => {
    const status = stepStatuses[stepIndex];
    if (status === "completed") return "bg-emerald-500 text-white";
    if (status === "in-progress") return "bg-blue-500 text-white";
    if (status === "error") return "bg-red-500 text-white";
    return "bg-muted text-muted-foreground";
  };

  return (
    <WalletGuard
      title="Sözleşme Oluşturma"
      description="Sui ağı üzerinde işlem yapmak için Slush (Sui Wallet) ile bağlanın."
    >
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">AI ile Sözleşme Oluştur (Sui)</h1>
          <p className="text-muted-foreground">Yapay zeka destekli sözleşme oluşturma aracı</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-emerald-500" />
                  Sözleşme Açıklaması
                </CardTitle>
                <CardDescription>Oluşturmak istediğiniz sözleşmeyi açıklayın</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder="Örnek: Freelance yazılım sözleşmesi, teslim: 30 gün..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[120px]"
                />
                <Button
                  className="w-full mt-4 bg-emerald-500 hover:bg-emerald-600"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      AI Oluşturuyor...
                    </>
                  ) : (
                    <>
                      <Bot className="mr-2 h-4 w-4" />
                      Sözleşme Oluştur
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Yapılandırılmış Alanlar (Opsiyonel)</CardTitle>
                <CardDescription>Daha detaylı bilgi için bu alanları doldurun</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Taraflar</Label>
                  {parties.map((party, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <Input
                        placeholder="İsim"
                        value={party.name}
                        onChange={(e) => {
                          const arr = [...parties];
                          arr[index].name = e.target.value;
                          setParties(arr);
                        }}
                      />
                      <Input
                        placeholder="Sui Adresi (0x...)"
                        value={party.address}
                        onChange={(e) => {
                          const arr = [...parties];
                          arr[index].address = e.target.value;
                          setParties(arr);
                        }}
                      />
                      {parties.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setParties(parties.filter((_, i) => i !== index))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setParties([...parties, { name: "", address: "" }])}>
                    <Plus className="mr-2 h-4 w-4" />
                    Taraf Ekle
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="country">Ülke/Yer</Label>
                    <Input id="country" placeholder="Türkiye" value={country} onChange={(e) => setCountry(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="currency">Para Birimi</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SUI">SUI</SelectItem>
                        <SelectItem value="TL">TL</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="deadline">Son Tarih</Label>
                    <Input id="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="termination">Fesih Süresi (gün)</Label>
                    <Input
                      id="termination"
                      type="number"
                      placeholder="30"
                      value={termination}
                      onChange={(e) => setTermination(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <Label htmlFor="paymentCoin">Payment Coin Object ID (Coin&lt;SUI&gt;)</Label>
                    <Input
                      id="paymentCoin"
                      placeholder="0x... (gas coiniyle aynı olmasın)"
                      value={paymentCoin}
                      onChange={(e) => setPaymentCoin(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right */}
          <div className="space-y-6">
            {generatedContract ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Oluşturulan Sözleşme</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="contract" className="w-full">
                      <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="contract">Sözleşme</TabsTrigger>
                        <TabsTrigger value="summary">Özet</TabsTrigger>
                        <TabsTrigger value="risk">Risk Analizi</TabsTrigger>
                      </TabsList>
                      <TabsContent value="contract" className="mt-4">
                        <div className="bg-muted/30 rounded-lg p-4 max-h-[400px] overflow-y-auto">
                          <pre className="text-sm whitespace-pre-wrap">{generatedContract.contract}</pre>
                        </div>
                      </TabsContent>
                      <TabsContent value="summary" className="mt-4">
                        <ul className="space-y-2">
                          {generatedContract.summary.map((item: string, index: number) => (
                            <li key={index} className="flex items-start gap-2">
                              <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                              <span className="text-sm">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </TabsContent>
                      <TabsContent value="risk" className="mt-4">
                        <div className="space-y-3">
                          {generatedContract.riskAnalysis.map((risk: any, index: number) => (
                            <div key={index} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  {(() => {
                                    switch (risk.level) {
                                      case "High":
                                        return <Badge variant="destructive">Yüksek</Badge>;
                                      case "Medium":
                                        return (
                                          <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                                            Orta
                                          </Badge>
                                        );
                                      case "Low":
                                        return (
                                          <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                                            Mini
                                          </Badge>
                                        );
                                      default:
                                        return <Badge variant="outline">{risk.level}</Badge>;
                                    }
                                  })()}
                                </div>
                                <p className="text-sm text-muted-foreground">{risk.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Sözleşme İşleme Adımları</CardTitle>
                    <CardDescription>
                      IPFS’e yükledikten sonra imzacıları davet edin; Slush ile imzalanıp gönderilir.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {steps.map((step, index) => (
                        <div key={index} className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getStepColor(index)}`}>
                            {getStepIcon(index)}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium">{step.title}</h4>
                            <p className="text-sm text-muted-foreground">{step.description}</p>

                            {index === 2 && ipfsCid && (
                              <div className="text-xs mt-1 space-y-1">
                                <p className="text-emerald-600 break-all">CID: {ipfsCid}</p>
                                {ipfsViewUrl && (
                                  <a
                                    className="underline text-emerald-500 break-all"
                                    href={ipfsViewUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    IPFS Gateway URL
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                          {stepStatuses[index] === "pending" && index > 0 && (
                            <Button size="sm" onClick={() => handleStepAction(index)}>
                              Başlat
                            </Button>
                          )}
                          {stepStatuses[index] === "error" && (
                            <Button size="sm" variant="destructive" onClick={() => handleStepAction(index)}>
                              Tekrar Dene
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>

                    {lastSubmitResponse && (
                      <div className="mt-4 rounded-lg border p-3 text-xs">
                        <div className="font-medium mb-1">Son Gönderim Cevabı</div>
                        <pre className="whitespace-pre-wrap break-all">
                          {JSON.stringify(lastSubmitResponse, null, 2)}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Invite Signers Dialog */}
                <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>İmzacıları Davet Et</DialogTitle>
                      <DialogDescription>Sözleşmeyi imzalaması için kişileri davet edin</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Cüzdan Adresleri (Sui)</Label>
                        <div className="flex gap-2 mt-2">
                          <Input placeholder="0x..." value={newSigner} onChange={(e) => setNewSigner(e.target.value)} />
                          <Button size="sm" onClick={addSigner}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        {signers.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {signers.map((signer, index) => (
                              <Badge key={index} variant="secondary" className="flex items-center gap-1">
                                {signer}
                                <X className="h-3 w-3 cursor-pointer" onClick={() => removeSigner(index)} />
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <Label>Payment Coin Object ID (Coin&lt;SUI&gt;)</Label>
                        <Input
                          placeholder="0x..."
                          value={paymentCoin}
                          onChange={(e) => setPaymentCoin(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground mt-1">Not: Gas coiniyle aynı object kullanılamaz.</p>
                      </div>

                      <div>
                        <Label>Davet Mesajı (opsiyonel)</Label>
                        <Textarea
                          placeholder="Sözleşmeyi inceleyip imzalamanızı rica ederim..."
                          value={inviteMessage}
                          onChange={(e) => setInviteMessage(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
                        İptal
                      </Button>
                      <Button onClick={handleInviteAndSign} disabled={signers.length === 0 || !paymentCoin}>
                        <Send className="mr-2 h-4 w-4" />
                        Davet Gönder & İmzala
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            ) : (
              <Card className="text-center py-12">
                <CardContent>
                  <Bot className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">AI Sözleşme Oluşturucu</h3>
                  <p className="text-muted-foreground mb-4">
                    Sözleşme açıklamanızı girin ve AI'ın sizin için profesyonel bir sözleşme oluşturmasını sağlayın
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </WalletGuard>
  );
}
