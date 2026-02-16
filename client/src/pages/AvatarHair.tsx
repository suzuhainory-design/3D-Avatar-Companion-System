import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StepNavigation, AVATAR_CREATION_STEPS } from "@/components/StepNavigation";
import { AvatarPreview3D } from "@/components/AvatarPreview3D";
import { useLocation, useParams } from "wouter";
import { useState, useEffect } from "react";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

type HairParams = {
  isBald: boolean;
  length: number;
  volume: number;
  curliness: number;
  baseColor: string;
  tipColor: string;
  midColor: string;
  useGradient: boolean;
  tipLength: number;
  tipStyle: number;
  rootVolume: number;
  bangsLength: number;
  bangsStyle: number;
  partingPosition: number;
};

const DEFAULT_HAIR: HairParams = {
  isBald: false, length: 40, volume: 50, curliness: 20,
  baseColor: "#2a1a0a", tipColor: "#3d2b1a", midColor: "#33220f",
  useGradient: false, tipLength: 30, tipStyle: 50, rootVolume: 50,
  bangsLength: 30, bangsStyle: 50, partingPosition: 50,
};

const HAIR_COLOR_PRESETS = [
  { name: "黑色", color: "#1a1a1a" },
  { name: "深棕", color: "#2a1a0a" },
  { name: "栗色", color: "#5c3317" },
  { name: "金色", color: "#c4a35a" },
  { name: "红棕", color: "#8b3a3a" },
  { name: "酒红", color: "#722f37" },
  { name: "亚麻", color: "#b5a68c" },
  { name: "灰色", color: "#808080" },
  { name: "银白", color: "#c0c0c0" },
  { name: "蓝色", color: "#2c3e7a" },
  { name: "紫色", color: "#6b3fa0" },
  { name: "粉色", color: "#e8a0bf" },
];

export default function AvatarHair() {
  useAuth({ redirectOnUnauthenticated: true });
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const avatarId = parseInt(params.id);

  const avatarQuery = trpc.avatar.get.useQuery({ id: avatarId });
  const updateMutation = trpc.avatar.update.useMutation();
  const saveStepMutation = trpc.avatar.saveStep.useMutation();

  const [hair, setHair] = useState<HairParams>(DEFAULT_HAIR);

  useEffect(() => {
    if (avatarQuery.data?.hairParams) {
      setHair({ ...DEFAULT_HAIR, ...(avatarQuery.data.hairParams as Partial<HairParams>) });
    }
  }, [avatarQuery.data]);

  const updateHair = (key: keyof HairParams, value: any) => {
    setHair((prev) => ({ ...prev, [key]: value }));
  };

  const handleNext = async () => {
    try {
      await saveStepMutation.mutateAsync({
        avatarId, stepName: "hair",
        paramsSnapshot: { hairParams: hair }, stepOrder: 3,
      });
      await updateMutation.mutateAsync({
        id: avatarId, hairParams: hair, currentStep: "clothing",
      });
      navigate(`/avatar/${avatarId}/clothing`);
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
          <h1 className="font-bold gradient-text">发型设计</h1>
        </div>
      </header>

      <main className="container py-8 max-w-6xl mx-auto">
        <div className="mb-8">
          <StepNavigation
            steps={AVATAR_CREATION_STEPS}
            currentStep="hair"
            avatarId={avatarId}
            onBack={() => navigate(`/avatar/${avatarId}/appearance`)}
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
              hairParams={{ length: hair.length, baseColor: hair.baseColor, isBald: hair.isBald, volume: hair.volume, curliness: hair.curliness, tipColor: hair.tipColor, midColor: hair.midColor, useGradient: hair.useGradient, bangsLength: hair.bangsLength }}
            />
          </div>

          <div>
            {/* Bald toggle */}
            <Card className="bg-card border-border mb-4">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">秃头模式</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">选择默认秃头或自定义发型</p>
                  </div>
                  <Switch
                    checked={hair.isBald}
                    onCheckedChange={(v) => updateHair("isBald", v)}
                  />
                </div>
              </CardContent>
            </Card>

            {!hair.isBald && (
              <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-4">
                  <TabsTrigger value="basic" className="text-xs">基础参数</TabsTrigger>
                  <TabsTrigger value="color" className="text-xs">颜色与渐变</TabsTrigger>
                  <TabsTrigger value="detail" className="text-xs">细节调节</TabsTrigger>
                </TabsList>

                {/* Basic */}
                <TabsContent value="basic">
                  <Card className="bg-card border-border">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold">基础参数</h3>
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setHair(DEFAULT_HAIR)}>
                          <RotateCcw className="w-3.5 h-3.5" /> 重置
                        </Button>
                      </div>
                      <div className="space-y-5">
                        {[
                          { key: "length" as const, label: "头发长度", min: 5, max: 100 },
                          { key: "volume" as const, label: "发量", min: 10, max: 100 },
                          { key: "curliness" as const, label: "卷曲度", min: 0, max: 100 },
                          { key: "bangsLength" as const, label: "刘海长度", min: 0, max: 80 },
                          { key: "bangsStyle" as const, label: "刘海样式", min: 0, max: 100 },
                          { key: "partingPosition" as const, label: "分缝位置", min: 0, max: 100 },
                        ].map(({ key, label, min, max }) => (
                          <div key={key} className="space-y-1.5">
                            <div className="flex justify-between">
                              <Label className="text-xs">{label}</Label>
                              <span className="text-xs font-mono text-primary">{hair[key]}</span>
                            </div>
                            <Slider
                              value={[hair[key] as number]}
                              min={min} max={max} step={1}
                              onValueChange={([v]) => updateHair(key, v)}
                            />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Color */}
                <TabsContent value="color">
                  <Card className="bg-card border-border">
                    <CardContent className="p-6">
                      <h3 className="font-semibold mb-4">发色选择</h3>
                      <div className="grid grid-cols-6 gap-2 mb-6">
                        {HAIR_COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.name}
                            className={`aspect-square rounded-lg border-2 transition-all hover:scale-105 active:scale-95 ${
                              hair.baseColor === preset.color ? "border-primary glow-cyan" : "border-border"
                            }`}
                            style={{ backgroundColor: preset.color }}
                            onClick={() => {
                              updateHair("baseColor", preset.color);
                              if (!hair.useGradient) {
                                updateHair("tipColor", preset.color);
                                updateHair("midColor", preset.color);
                              }
                            }}
                            title={preset.name}
                          />
                        ))}
                      </div>

                      <div className="flex items-center justify-between mb-4 mt-6">
                        <div>
                          <h4 className="font-medium text-sm">渐变效果</h4>
                          <p className="text-xs text-muted-foreground">启用后可分别设置发根、发中、发梢颜色</p>
                        </div>
                        <Switch
                          checked={hair.useGradient}
                          onCheckedChange={(v) => updateHair("useGradient", v)}
                        />
                      </div>

                      {hair.useGradient && (
                        <div className="space-y-4 mt-4">
                          {[
                            { key: "baseColor" as const, label: "发根颜色" },
                            { key: "midColor" as const, label: "发中颜色" },
                            { key: "tipColor" as const, label: "发梢颜色" },
                          ].map(({ key, label }) => (
                            <div key={key}>
                              <Label className="text-xs mb-2 block">{label}</Label>
                              <div className="flex items-center gap-3">
                                <input
                                  type="color"
                                  value={hair[key] as string}
                                  onChange={(e) => updateHair(key, e.target.value)}
                                  className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent"
                                />
                                <span className="text-xs font-mono text-muted-foreground">{hair[key]}</span>
                              </div>
                            </div>
                          ))}
                          {/* Gradient preview */}
                          <div className="mt-4">
                            <Label className="text-xs mb-2 block">渐变预览</Label>
                            <div
                              className="h-8 rounded-lg border border-border"
                              style={{
                                background: `linear-gradient(to right, ${hair.baseColor}, ${hair.midColor}, ${hair.tipColor})`,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Detail */}
                <TabsContent value="detail">
                  <Card className="bg-card border-border">
                    <CardContent className="p-6">
                      <h3 className="font-semibold mb-4">细节调节</h3>
                      <div className="space-y-5">
                        {[
                          { key: "tipLength" as const, label: "发梢长度", min: 0, max: 100 },
                          { key: "tipStyle" as const, label: "发梢样式（齐/碎）", min: 0, max: 100 },
                          { key: "rootVolume" as const, label: "发根蓬松度", min: 0, max: 100 },
                        ].map(({ key, label, min, max }) => (
                          <div key={key} className="space-y-1.5">
                            <div className="flex justify-between">
                              <Label className="text-xs">{label}</Label>
                              <span className="text-xs font-mono text-primary">{hair[key]}</span>
                            </div>
                            <Slider
                              value={[hair[key] as number]}
                              min={min} max={max} step={1}
                              onValueChange={([v]) => updateHair(key, v)}
                            />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
