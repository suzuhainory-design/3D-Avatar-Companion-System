import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import {
  Plus, User, MessageSquare, Sparkles, Upload, Scissors, Shirt,
  Box, LogOut, Loader2, Trash2, ArrowRight
} from "lucide-react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  customizing: "定制中",
  rendering: "渲染中",
  completed: "已完成",
};

const STEP_LABELS: Record<string, string> = {
  upload: "上传图片",
  skeleton: "骨架调整",
  appearance: "外观定制",
  hair: "发型设计",
  clothing: "服装选择",
  final: "最终渲染",
};

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const avatarsQuery = trpc.avatar.list.useQuery(undefined, { enabled: isAuthenticated });
  const createMutation = trpc.avatar.create.useMutation({
    onSuccess: (data) => {
      navigate(`/avatar/upload/${data.id}`);
    },
  });
  const deleteMutation = trpc.avatar.delete.useMutation({
    onSuccess: () => {
      avatarsQuery.refetch();
      toast.success("数字人已删除");
    },
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col bg-background bg-grid">
        {/* Hero Section */}
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="text-center max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5 mb-8">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm text-primary font-medium">AI驱动的3D数字人平台</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6">
              <span className="gradient-text">创建你的</span>
              <br />
              <span className="text-foreground">3D数字人伴侣</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-10 max-w-lg mx-auto leading-relaxed">
              上传一张照片，即可生成专属3D数字人。支持精细化定制外观、发型、服装，
              并通过AI对话实现实时互动。
            </p>
            <Button
              size="lg"
              className="glow-cyan text-base px-8 py-6 font-semibold"
              onClick={() => (window.location.href = getLoginUrl())}
            >
              开始创建
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-16 max-w-3xl mx-auto w-full px-4">
            {[
              { icon: <Upload className="w-5 h-5" />, title: "一键生成", desc: "上传照片自动生成3D模型" },
              { icon: <Scissors className="w-5 h-5" />, title: "精细定制", desc: "骨架、五官、发型、服装全面调节" },
              { icon: <MessageSquare className="w-5 h-5" />, title: "AI对话", desc: "情绪驱动的实时互动体验" },
            ].map((f, i) => (
              <Card key={i} className="module-card bg-card border-border">
                <CardContent className="p-5 text-center">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3 text-primary">
                    {f.icon}
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{f.title}</h3>
                  <p className="text-xs text-muted-foreground">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Authenticated dashboard
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <Box className="w-5 h-5 text-primary" />
            <h1 className="font-bold text-base gradient-text">3D Avatar Studio</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="w-4 h-4" />
              <span>{user?.name || "用户"}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => logout()} className="gap-1.5">
              <LogOut className="w-3.5 h-3.5" />
              退出
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold">我的数字人</h2>
            <p className="text-sm text-muted-foreground mt-1">管理和创建你的3D数字人伴侣</p>
          </div>
          <Button
            onClick={() => createMutation.mutate({})}
            disabled={createMutation.isPending}
            className="glow-cyan gap-2"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            创建数字人
          </Button>
        </div>

        {/* Avatar grid */}
        {avatarsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : avatarsQuery.data?.length === 0 ? (
          <Card className="module-card border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Plus className="w-8 h-8 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">还没有数字人</h3>
              <p className="text-sm text-muted-foreground mb-6">点击上方按钮开始创建你的第一个3D数字人</p>
              <Button onClick={() => createMutation.mutate({})} className="glow-cyan">
                开始创建
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {avatarsQuery.data?.map((avatar) => (
              <Card
                key={avatar.id}
                className="module-card group"
                onClick={() => {
                  if (avatar.status === "completed") {
                    navigate(`/avatar/${avatar.id}/chat`);
                  } else {
                    const step = avatar.currentStep || "upload";
                    if (step === "upload") {
                      navigate(`/avatar/upload/${avatar.id}`);
                    } else {
                      navigate(`/avatar/${avatar.id}/${step}`);
                    }
                  }
                }}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <User className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        avatar.status === "completed"
                          ? "bg-neon-green/10 text-neon-green"
                          : avatar.status === "rendering"
                          ? "bg-neon-purple/10 text-neon-purple"
                          : "bg-neon-cyan/10 text-neon-cyan"
                      }`}>
                        {STATUS_LABELS[avatar.status] || avatar.status}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("确定要删除这个数字人吗？")) {
                            deleteMutation.mutate({ id: avatar.id });
                          }
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <h3 className="font-semibold mb-1">{avatar.name}</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {avatar.gender === "male" ? "男性" : "女性"} · {STEP_LABELS[avatar.currentStep] || avatar.currentStep}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(avatar.updatedAt).toLocaleDateString("zh-CN")}
                    </span>
                    {avatar.status === "completed" && (
                      <div className="flex items-center gap-1 text-xs text-primary">
                        <MessageSquare className="w-3.5 h-3.5" />
                        开始对话
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
