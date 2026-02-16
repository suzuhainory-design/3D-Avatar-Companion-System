import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StepNavigation, AVATAR_CREATION_STEPS } from "@/components/StepNavigation";
import { useLocation, useParams } from "wouter";
import { useState, useRef, useCallback } from "react";
import { Upload, Image as ImageIcon, Loader2, ArrowLeft, X } from "lucide-react";
import { toast } from "sonner";

export default function AvatarUpload() {
  useAuth({ redirectOnUnauthenticated: true });
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const avatarId = params.id ? parseInt(params.id) : undefined;

  const [name, setName] = useState("我的数字人");
  const [gender, setGender] = useState<"male" | "female">("female");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createMutation = trpc.avatar.create.useMutation();
  const uploadMutation = trpc.file.upload.useMutation();
  const generateMutation = trpc.avatar.generateModel.useMutation();

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("请上传图片文件");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("图片大小不能超过10MB");
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleSubmit = async () => {
    if (!imageFile) {
      toast.error("请先上传图片");
      return;
    }

    try {
      // Step 1: Create avatar if not exists
      let currentAvatarId = avatarId;
      if (!currentAvatarId) {
        const result = await createMutation.mutateAsync({ name, gender });
        currentAvatarId = result.id;
      }

      // Step 2: Upload image to S3
      const base64 = imagePreview!.split(",")[1];
      const uploadResult = await uploadMutation.mutateAsync({
        fileName: imageFile.name,
        mimeType: imageFile.type,
        base64Data: base64,
        purpose: "avatar_source",
        relatedId: currentAvatarId,
      });

      // Step 3: Generate 3D model
      await generateMutation.mutateAsync({
        avatarId: currentAvatarId,
        sourceImageUrl: uploadResult.url,
      });

      toast.success("模型生成成功！");
      navigate(`/avatar/${currentAvatarId}/skeleton`);
    } catch (error) {
      toast.error("处理失败，请重试");
    }
  };

  const isProcessing = createMutation.isPending || uploadMutation.isPending || generateMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center h-14 gap-4">
          <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="font-bold gradient-text">创建3D数字人</h1>
        </div>
      </header>

      <main className="container py-8 max-w-4xl mx-auto">
        {/* Step navigation */}
        <div className="mb-8">
          <StepNavigation
            steps={AVATAR_CREATION_STEPS}
            currentStep="upload"
            avatarId={avatarId}
            onBack={() => navigate("/")}
            onNext={handleSubmit}
            canProceed={!!imageFile}
            isProcessing={isProcessing}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Upload area */}
          <div>
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold mb-4">上传照片</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  上传一张正面全身照片，系统将使用 META SAM 分割人体并结合 SMPL-X 生成3D模型。
                </p>

                {/* Drop zone */}
                <div
                  className={`
                    relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
                    ${isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}
                    ${imagePreview ? "p-4" : "py-16"}
                  `}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                    }}
                  />

                  {imagePreview ? (
                    <div className="relative">
                      <img
                        src={imagePreview}
                        alt="预览"
                        className="max-h-[400px] mx-auto rounded-lg object-contain"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute top-2 right-2 w-7 h-7 bg-background/80"
                        onClick={(e) => {
                          e.stopPropagation();
                          setImageFile(null);
                          setImagePreview(null);
                        }}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                        <Upload className="w-8 h-8 text-primary" />
                      </div>
                      <p className="font-medium mb-1">拖拽图片到此处或点击上传</p>
                      <p className="text-xs text-muted-foreground">支持 JPG、PNG、WebP 格式，最大 10MB</p>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Settings */}
          <div className="space-y-4">
            <Card className="bg-card border-border">
              <CardContent className="p-6 space-y-4">
                <h2 className="text-lg font-semibold">基本设置</h2>

                <div className="space-y-2">
                  <Label htmlFor="name">数字人名称</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="输入名称"
                    className="bg-input"
                  />
                </div>

                <div className="space-y-2">
                  <Label>性别</Label>
                  <Select value={gender} onValueChange={(v) => setGender(v as "male" | "female")}>
                    <SelectTrigger className="bg-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female">女性</SelectItem>
                      <SelectItem value="male">男性</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold mb-3">技术说明</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-neon-cyan/10 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs text-neon-cyan font-bold">1</span>
                    </div>
                    <p><strong className="text-foreground">SAM 分割</strong> — 使用 META Segment Anything Model 精确分割人体轮廓</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-neon-purple/10 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs text-neon-purple font-bold">2</span>
                    </div>
                    <p><strong className="text-foreground">SMPL-X 拟合</strong> — 将关键点拟合到参数化人体模型，生成带骨骼的3D网格</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-neon-green/10 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs text-neon-green font-bold">3</span>
                    </div>
                    <p><strong className="text-foreground">纹理映射</strong> — 从原始图片提取纹理并贴到3D模型上</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {isProcessing && (
              <Card className="bg-card border-primary/30 glow-cyan">
                <CardContent className="p-6 flex items-center gap-4">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <div>
                    <p className="font-medium text-sm">正在生成3D模型...</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {createMutation.isPending ? "创建数字人..." :
                       uploadMutation.isPending ? "上传图片..." :
                       "SAM分割 + SMPL-X拟合中..."}
                    </p>
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
