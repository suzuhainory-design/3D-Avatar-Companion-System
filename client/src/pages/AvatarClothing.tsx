import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StepNavigation, AVATAR_CREATION_STEPS } from "@/components/StepNavigation";
import { AvatarPreview3D } from "@/components/AvatarPreview3D";
import { useLocation, useParams } from "wouter";
import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Loader2, Plus, Upload, Check, Shirt, Palette } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "top", label: "上装" },
  { value: "bottom", label: "下装" },
  { value: "dress", label: "连衣裙" },
  { value: "outerwear", label: "外套" },
  { value: "shoes", label: "鞋子" },
  { value: "accessory", label: "配饰" },
];

const DEFAULT_CLOTHING = [
  { id: -1, name: "白色T恤", category: "top", color: { r: 240, g: 240, b: 240 } },
  { id: -2, name: "黑色T恤", category: "top", color: { r: 30, g: 30, b: 30 } },
  { id: -3, name: "蓝色衬衫", category: "top", color: { r: 60, g: 100, b: 160 } },
  { id: -4, name: "牛仔裤", category: "bottom", color: { r: 60, g: 80, b: 120 } },
  { id: -5, name: "黑色长裤", category: "bottom", color: { r: 30, g: 30, b: 35 } },
  { id: -6, name: "红色连衣裙", category: "dress", color: { r: 180, g: 50, b: 50 } },
  { id: -7, name: "运动鞋", category: "shoes", color: { r: 200, g: 200, b: 200 } },
  { id: -8, name: "黑色外套", category: "outerwear", color: { r: 40, g: 40, b: 45 } },
];

export default function AvatarClothing() {
  useAuth({ redirectOnUnauthenticated: true });
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const avatarId = parseInt(params.id);

  const avatarQuery = trpc.avatar.get.useQuery({ id: avatarId });
  const clothingQuery = trpc.clothing.list.useQuery();
  const updateMutation = trpc.avatar.update.useMutation();
  const saveStepMutation = trpc.avatar.saveStep.useMutation();
  const createClothingMutation = trpc.clothing.create.useMutation({
    onSuccess: () => {
      clothingQuery.refetch();
      toast.success("服装已添加");
      setShowUploadDialog(false);
    },
  });
  const uploadMutation = trpc.file.upload.useMutation();

  const [selectedClothing, setSelectedClothing] = useState<number | null>(null);
  const [clothingColor, setClothingColor] = useState<{ r: number; g: number; b: number }>({ r: 60, g: 80, b: 120 });
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState("top");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (avatarQuery.data?.clothingId) {
      setSelectedClothing(avatarQuery.data.clothingId);
    }
  }, [avatarQuery.data]);

  const allClothing = [
    ...DEFAULT_CLOTHING,
    ...(clothingQuery.data || []).map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      color: (c.customColor || c.defaultColor || { r: 128, g: 128, b: 128 }) as { r: number; g: number; b: number },
    })),
  ];

  const filteredClothing = filterCategory === "all"
    ? allClothing
    : allClothing.filter((c) => c.category === filterCategory);

  const handleUploadClothing = async () => {
    if (!uploadFile || !uploadName) {
      toast.error("请填写名称并上传图片");
      return;
    }
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split(",")[1];
        const uploadResult = await uploadMutation.mutateAsync({
          fileName: uploadFile.name,
          mimeType: uploadFile.type,
          base64Data: base64,
          purpose: "clothing_source",
        });
        await createClothingMutation.mutateAsync({
          name: uploadName,
          category: uploadCategory as any,
          sourceImageUrl: uploadResult.url,
        });
      };
      reader.readAsDataURL(uploadFile);
    } catch {
      toast.error("上传失败");
    }
  };

  const handleNext = async () => {
    try {
      await saveStepMutation.mutateAsync({
        avatarId, stepName: "clothing",
        paramsSnapshot: { clothingId: selectedClothing, clothingColor }, stepOrder: 4,
      });
      await updateMutation.mutateAsync({
        id: avatarId,
        clothingId: selectedClothing || undefined,
        currentStep: "final",
      });
      navigate(`/avatar/${avatarId}/final`);
    } catch {
      toast.error("保存失败，请重试");
    }
  };

  if (avatarQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center h-14 gap-4">
          <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="font-bold gradient-text">服装选择</h1>
        </div>
      </header>

      <main className="container py-8 max-w-6xl mx-auto">
        <div className="mb-8">
          <StepNavigation
            steps={AVATAR_CREATION_STEPS}
            currentStep="clothing"
            avatarId={avatarId}
            onBack={() => navigate(`/avatar/${avatarId}/hair`)}
            onNext={handleNext}
            isProcessing={updateMutation.isPending || saveStepMutation.isPending}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="lg:sticky lg:top-20 lg:self-start">
            <AvatarPreview3D
              skeletonParams={avatarQuery.data?.skeletonParams as any}
              skinColor={avatarQuery.data?.skinParams as any}
              gender={avatarQuery.data?.gender || "female"}
              hairParams={avatarQuery.data?.hairParams as any}
              clothingColor={clothingColor}
            />
          </div>

          <div className="space-y-4">
            {/* Filter & Upload */}
            <div className="flex items-center gap-3">
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-32 bg-input">
                  <SelectValue placeholder="全部" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-1.5 ml-auto">
                    <Upload className="w-4 h-4" /> 上传服装
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-card">
                  <DialogHeader>
                    <DialogTitle>上传自定义服装</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <Label>服装名称</Label>
                      <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="输入名称" className="bg-input" />
                    </div>
                    <div className="space-y-2">
                      <Label>类别</Label>
                      <Select value={uploadCategory} onValueChange={setUploadCategory}>
                        <SelectTrigger className="bg-input"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>服装图片</Label>
                      <div
                        className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setUploadFile(file);
                              const reader = new FileReader();
                              reader.onload = (ev) => setUploadPreview(ev.target?.result as string);
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                        {uploadPreview ? (
                          <img src={uploadPreview} alt="预览" className="max-h-32 mx-auto rounded" />
                        ) : (
                          <>
                            <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">点击上传图片</p>
                          </>
                        )}
                      </div>
                    </div>
                    <Button
                      className="w-full"
                      onClick={handleUploadClothing}
                      disabled={createClothingMutation.isPending || uploadMutation.isPending}
                    >
                      {createClothingMutation.isPending || uploadMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : null}
                      添加到服装库
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {/* Clothing grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredClothing.map((item) => (
                <Card
                  key={item.id}
                  className={`module-card cursor-pointer transition-all ${
                    selectedClothing === item.id ? "border-primary glow-cyan" : ""
                  }`}
                  onClick={() => {
                    setSelectedClothing(item.id);
                    setClothingColor(item.color);
                  }}
                >
                  <CardContent className="p-4 text-center">
                    <div
                      className="w-12 h-12 rounded-xl mx-auto mb-2 flex items-center justify-center border border-border"
                      style={{ backgroundColor: `rgb(${item.color.r},${item.color.g},${item.color.b})` }}
                    >
                      <Shirt className="w-6 h-6 text-white/70" />
                    </div>
                    <p className="text-xs font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORIES.find((c) => c.value === item.category)?.label || item.category}
                    </p>
                    {selectedClothing === item.id && (
                      <div className="mt-2">
                        <Check className="w-4 h-4 text-primary mx-auto" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Color adjustment for selected clothing */}
            {selectedClothing && (
              <Card className="bg-card border-border">
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Palette className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-sm">颜色调节</h3>
                  </div>
                  <div className="space-y-3">
                    {[
                      { key: "r" as const, label: "红", max: 255 },
                      { key: "g" as const, label: "绿", max: 255 },
                      { key: "b" as const, label: "蓝", max: 255 },
                    ].map(({ key, label, max }) => (
                      <div key={key} className="flex items-center gap-3">
                        <Label className="text-xs w-6">{label}</Label>
                        <div className="flex-1">
                          <input
                            type="range"
                            min={0}
                            max={max}
                            value={clothingColor[key]}
                            onChange={(e) => setClothingColor({ ...clothingColor, [key]: parseInt(e.target.value) })}
                            className="w-full accent-primary"
                          />
                        </div>
                        <span className="text-xs font-mono w-8 text-right text-primary">{clothingColor[key]}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 mt-2">
                      <div
                        className="w-8 h-8 rounded-lg border border-border"
                        style={{ backgroundColor: `rgb(${clothingColor.r},${clothingColor.g},${clothingColor.b})` }}
                      />
                      <span className="text-xs text-muted-foreground font-mono">
                        rgb({clothingColor.r}, {clothingColor.g}, {clothingColor.b})
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
