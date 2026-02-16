import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepNavigation, AVATAR_CREATION_STEPS } from "@/components/StepNavigation";
import { AvatarPreview3D } from "@/components/AvatarPreview3D";
import { useLocation, useParams } from "wouter";
import { useState, useEffect } from "react";
import {
  ArrowLeft, Loader2, Download, MessageSquare, CheckCircle2, Ruler, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

export default function AvatarFinalRender() {
  useAuth({ redirectOnUnauthenticated: true });
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const avatarId = parseInt(params.id);

  const avatarQuery = trpc.avatar.get.useQuery({ id: avatarId });
  const finalRenderMutation = trpc.avatar.finalRender.useMutation();
  const saveStepMutation = trpc.avatar.saveStep.useMutation();

  const [finalHeight, setFinalHeight] = useState(170);
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    if (avatarQuery.data) {
      if (avatarQuery.data.finalHeight) {
        setFinalHeight(avatarQuery.data.finalHeight);
      } else if (avatarQuery.data.skeletonParams) {
        setFinalHeight((avatarQuery.data.skeletonParams as any).height || 170);
      }
      if (avatarQuery.data.status === "completed") {
        setIsRendered(true);
      }
    }
  }, [avatarQuery.data]);

  const handleRender = async () => {
    try {
      await saveStepMutation.mutateAsync({
        avatarId, stepName: "final",
        paramsSnapshot: { finalHeight }, stepOrder: 5,
      });
      await finalRenderMutation.mutateAsync({ avatarId, finalHeight });
      setIsRendered(true);
      toast.success("渲染完成！");
      avatarQuery.refetch();
    } catch {
      toast.error("渲染失败，请重试");
    }
  };

  if (avatarQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const avatar = avatarQuery.data;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center h-14 gap-4">
          <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="font-bold gradient-text">最终渲染</h1>
        </div>
      </header>

      <main className="container py-8 max-w-6xl mx-auto">
        <div className="mb-8">
          <StepNavigation
            steps={AVATAR_CREATION_STEPS}
            currentStep="final"
            avatarId={avatarId}
            onBack={() => navigate(`/avatar/${avatarId}/clothing`)}
            onNext={() => {
              if (isRendered) {
                navigate(`/avatar/${avatarId}/chat`);
              } else {
                handleRender();
              }
            }}
            canProceed={finalHeight >= 50 && finalHeight <= 250}
            isProcessing={finalRenderMutation.isPending || saveStepMutation.isPending}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="lg:sticky lg:top-20 lg:self-start">
            <AvatarPreview3D
              glbUrl={avatar?.modelFileUrl || undefined}
              skeletonParams={{ ...(avatar?.skeletonParams as any), height: finalHeight }}
              skinColor={avatar?.skinParams as any}
              gender={avatar?.gender || "female"}
              hairParams={avatar?.hairParams as any}
              clothingParams={undefined}
            />
          </div>

          <div className="space-y-4">
            {/* Height input */}
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Ruler className="w-5 h-5 text-primary" />
                  <h2 className="text-lg font-semibold">设定最终身高</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  输入期望的3D数字人身高（厘米），系统将按此比例进行最终模型拟合渲染。
                </p>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <Input
                      type="number"
                      value={finalHeight}
                      onChange={(e) => setFinalHeight(parseInt(e.target.value) || 0)}
                      min={50}
                      max={250}
                      className="bg-input text-lg font-mono"
                    />
                  </div>
                  <span className="text-lg font-medium text-muted-foreground">cm</span>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <input
                    type="range"
                    min={50}
                    max={250}
                    value={finalHeight}
                    onChange={(e) => setFinalHeight(parseInt(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>50cm</span>
                  <span>250cm</span>
                </div>
              </CardContent>
            </Card>

            {/* Summary */}
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold mb-4">参数总览</h2>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">名称</span>
                    <span className="font-medium">{avatar?.name}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">性别</span>
                    <span className="font-medium">{avatar?.gender === "male" ? "男性" : "女性"}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">最终身高</span>
                    <span className="font-medium font-mono text-primary">{finalHeight}cm</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">肩宽</span>
                    <span className="font-medium font-mono">{(avatar?.skeletonParams as any)?.shoulderWidth || "—"}cm</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-muted-foreground">输出格式</span>
                    <span className="font-medium">.glb (glTF Binary)</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Render button */}
            {!isRendered ? (
              <Button
                className="w-full py-6 text-base glow-cyan"
                onClick={handleRender}
                disabled={finalRenderMutation.isPending || saveStepMutation.isPending}
              >
                {finalRenderMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    正在渲染...
                  </>
                ) : (
                  "开始最终渲染"
                )}
              </Button>
            ) : (
              <div className="space-y-3">
                <Card className="bg-card border-neon-green/30">
                  <CardContent className="p-6 flex items-center gap-4">
                    <CheckCircle2 className="w-8 h-8 text-neon-green" />
                    <div>
                      <p className="font-semibold text-neon-green">渲染完成</p>
                      <p className="text-xs text-muted-foreground mt-0.5">3D数字人模型已生成</p>
                    </div>
                  </CardContent>
                </Card>
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" className="gap-2 py-5" onClick={() => toast.info("模型下载功能即将上线")}>
                    <Download className="w-4 h-4" />
                    下载 .glb
                  </Button>
                  <Button className="gap-2 py-5 glow-cyan" onClick={() => navigate(`/avatar/${avatarId}/chat`)}>
                    <MessageSquare className="w-4 h-4" />
                    开始对话
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
