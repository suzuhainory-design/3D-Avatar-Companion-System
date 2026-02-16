import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StepNavigation, AVATAR_CREATION_STEPS } from "@/components/StepNavigation";
import { AvatarPreview3D } from "@/components/AvatarPreview3D";
import { useSmplxModel, skinParamsToColor } from "@/hooks/useSmplxModel";
import { useLocation, useParams } from "wouter";
import { useState, useEffect } from "react";
import { ArrowLeft, Loader2, RotateCcw, Palette, Eye, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

type SkinParams = { r: number; g: number; b: number; brightness: number; saturation: number };
type FacialParams = Record<string, number>;
type GenderFeatureParams = Record<string, number>;
type MakeupParams = Record<string, any>;

const SKIN_PRESETS = [
  { name: "白皙", r: 255, g: 224, b: 196 },
  { name: "自然", r: 235, g: 200, b: 178 },
  { name: "小麦", r: 210, g: 170, b: 140 },
  { name: "蜜糖", r: 185, g: 140, b: 110 },
  { name: "古铜", r: 160, g: 120, b: 90 },
  { name: "深棕", r: 120, g: 85, b: 65 },
];

const FACIAL_CONFIG = [
  { key: "eyeSize", label: "眼睛大小", min: 0, max: 100 },
  { key: "eyeDistance", label: "眼距", min: 0, max: 100 },
  { key: "eyeHeight", label: "眼睛高度", min: 0, max: 100 },
  { key: "noseHeight", label: "鼻梁高度", min: 0, max: 100 },
  { key: "noseWidth", label: "鼻翼宽度", min: 0, max: 100 },
  { key: "noseBridge", label: "鼻梁立体感", min: 0, max: 100 },
  { key: "mouthWidth", label: "嘴巴宽度", min: 0, max: 100 },
  { key: "lipThickness", label: "嘴唇厚度", min: 0, max: 100 },
  { key: "jawWidth", label: "下颌宽度", min: 0, max: 100 },
  { key: "chinLength", label: "下巴长度", min: 0, max: 100 },
  { key: "cheekboneHeight", label: "颧骨高度", min: 0, max: 100 },
  { key: "faceDepth", label: "面部立体感", min: 0, max: 100 },
];

const MAKEUP_CONFIG = [
  { key: "eyeshadowIntensity", label: "眼影强度", min: 0, max: 100 },
  { key: "blushIntensity", label: "腮红强度", min: 0, max: 100 },
  { key: "lipIntensity", label: "口红强度", min: 0, max: 100 },
  { key: "eyelinerIntensity", label: "眼线强度", min: 0, max: 100 },
  { key: "foundationIntensity", label: "粉底强度", min: 0, max: 100 },
];

const MAKEUP_COLORS = [
  "#e74c3c", "#c0392b", "#e91e63", "#9b59b6", "#8e44ad",
  "#d4a574", "#f39c12", "#e67e22", "#ff6b6b", "#ee5a24",
];

export default function AvatarAppearance() {
  useAuth({ redirectOnUnauthenticated: true });
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const avatarId = parseInt(params.id);

  const avatarQuery = trpc.avatar.get.useQuery({ id: avatarId });
  const updateMutation = trpc.avatar.update.useMutation();
  const saveStepMutation = trpc.avatar.saveStep.useMutation();

  const [skin, setSkin] = useState<SkinParams>({ r: 235, g: 200, b: 178, brightness: 50, saturation: 50 });
  const [facial, setFacial] = useState<FacialParams>({
    eyeSize: 50, eyeDistance: 50, eyeHeight: 50, noseHeight: 50, noseWidth: 50,
    noseBridge: 50, mouthWidth: 50, lipThickness: 50, jawWidth: 50, chinLength: 50,
    cheekboneHeight: 50, faceDepth: 50,
  });
  const [genderFeatures, setGenderFeatures] = useState<GenderFeatureParams>({});
  const [makeup, setMakeup] = useState<MakeupParams>({
    eyeshadowColor: null, eyeshadowIntensity: 0, blushColor: null, blushIntensity: 0,
    lipColor: null, lipIntensity: 0, eyelinerIntensity: 0, foundationIntensity: 0,
  });

  useEffect(() => {
    if (avatarQuery.data) {
      if (avatarQuery.data.skinParams) setSkin(avatarQuery.data.skinParams as SkinParams);
      if (avatarQuery.data.facialParams) setFacial(avatarQuery.data.facialParams as FacialParams);
      if (avatarQuery.data.genderFeatureParams) setGenderFeatures(avatarQuery.data.genderFeatureParams as GenderFeatureParams);
      if (avatarQuery.data.makeupParams) setMakeup(avatarQuery.data.makeupParams as MakeupParams);
    }
  }, [avatarQuery.data]);

  const gender = avatarQuery.data?.gender || "female";

  // Use SMPL-X model hook for real model generation
  const smplxModel = useSmplxModel({
    avatarId,
    gender: gender as "male" | "female",
    existingGlbUrl: avatarQuery.data?.modelFileUrl || null,
    skeletonParams: avatarQuery.data?.skeletonParams as any,
    skinColor: skinParamsToColor(skin),
  });

  const handleNext = async () => {
    try {
      await saveStepMutation.mutateAsync({
        avatarId,
        stepName: "appearance",
        paramsSnapshot: { skinParams: skin, facialParams: facial, genderFeatureParams: genderFeatures, makeupParams: makeup },
        stepOrder: 2,
      });
      await updateMutation.mutateAsync({
        id: avatarId,
        skinParams: skin,
        facialParams: facial,
        genderFeatureParams: genderFeatures,
        makeupParams: makeup,
        currentStep: "hair",
      });
      navigate(`/avatar/${avatarId}/hair`);
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
          <h1 className="font-bold gradient-text">外观定制</h1>
        </div>
      </header>

      <main className="container py-8 max-w-6xl mx-auto">
        <div className="mb-8">
          <StepNavigation
            steps={AVATAR_CREATION_STEPS}
            currentStep="appearance"
            avatarId={avatarId}
            onBack={() => navigate(`/avatar/${avatarId}/skeleton`)}
            onNext={handleNext}
            isProcessing={updateMutation.isPending || saveStepMutation.isPending}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="lg:sticky lg:top-20 lg:self-start">
            <AvatarPreview3D
              glbUrl={smplxModel.glbUrl || undefined}
              skeletonParams={avatarQuery.data?.skeletonParams as any}
              skinColor={skin}
              gender={gender}
            />
          </div>

          <div>
            <Tabs defaultValue="skin" className="w-full">
              <TabsList className="grid w-full grid-cols-4 mb-4">
                <TabsTrigger value="skin" className="gap-1.5 text-xs">
                  <Palette className="w-3.5 h-3.5" /> 肤色
                </TabsTrigger>
                <TabsTrigger value="facial" className="gap-1.5 text-xs">
                  <Eye className="w-3.5 h-3.5" /> 五官
                </TabsTrigger>
                <TabsTrigger value="gender" className="gap-1.5 text-xs">
                  <User className="w-3.5 h-3.5" /> 特征
                </TabsTrigger>
                <TabsTrigger value="makeup" className="gap-1.5 text-xs">
                  <Sparkles className="w-3.5 h-3.5" /> 妆容
                </TabsTrigger>
              </TabsList>

              {/* Skin Tab */}
              <TabsContent value="skin">
                <Card className="bg-card border-border">
                  <CardContent className="p-6">
                    <h3 className="font-semibold mb-4">肤色选择</h3>
                    <div className="grid grid-cols-6 gap-3 mb-6">
                      {SKIN_PRESETS.map((preset) => (
                        <button
                          key={preset.name}
                          className={`aspect-square rounded-xl border-2 transition-all hover:scale-105 active:scale-95 ${
                            skin.r === preset.r && skin.g === preset.g && skin.b === preset.b
                              ? "border-primary glow-cyan"
                              : "border-border"
                          }`}
                          style={{ backgroundColor: `rgb(${preset.r},${preset.g},${preset.b})` }}
                          onClick={() => setSkin({ ...skin, r: preset.r, g: preset.g, b: preset.b })}
                          title={preset.name}
                        />
                      ))}
                    </div>
                    <div className="space-y-4">
                      {[
                        { key: "r" as const, label: "红色", max: 255 },
                        { key: "g" as const, label: "绿色", max: 255 },
                        { key: "b" as const, label: "蓝色", max: 255 },
                        { key: "brightness" as const, label: "亮度", max: 100 },
                        { key: "saturation" as const, label: "饱和度", max: 100 },
                      ].map(({ key, label, max }) => (
                        <div key={key} className="space-y-1.5">
                          <div className="flex justify-between">
                            <Label className="text-xs">{label}</Label>
                            <span className="text-xs font-mono text-primary">{skin[key]}</span>
                          </div>
                          <Slider
                            value={[skin[key]]}
                            min={0}
                            max={max}
                            step={1}
                            onValueChange={([v]) => setSkin({ ...skin, [key]: v })}
                          />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Facial Tab */}
              <TabsContent value="facial">
                <Card className="bg-card border-border">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold">五官调整</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          const reset: FacialParams = {};
                          FACIAL_CONFIG.forEach((c) => (reset[c.key] = 50));
                          setFacial(reset);
                        }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> 重置
                      </Button>
                    </div>
                    <div className="space-y-4">
                      {FACIAL_CONFIG.map(({ key, label, min, max }) => (
                        <div key={key} className="space-y-1.5">
                          <div className="flex justify-between">
                            <Label className="text-xs">{label}</Label>
                            <span className="text-xs font-mono text-primary">{facial[key]}</span>
                          </div>
                          <Slider
                            value={[facial[key] ?? 50]}
                            min={min}
                            max={max}
                            step={1}
                            onValueChange={([v]) => setFacial({ ...facial, [key]: v })}
                          />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Gender Features Tab */}
              <TabsContent value="gender">
                <Card className="bg-card border-border">
                  <CardContent className="p-6">
                    <h3 className="font-semibold mb-4">
                      {gender === "female" ? "女性特征" : "男性特征"}
                    </h3>
                    <div className="space-y-4">
                      {gender === "female" ? (
                        <div className="space-y-1.5">
                          <div className="flex justify-between">
                            <Label className="text-xs">胸部大小</Label>
                            <span className="text-xs font-mono text-primary">{genderFeatures.breastSize ?? 50}</span>
                          </div>
                          <Slider
                            value={[genderFeatures.breastSize ?? 50]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={([v]) => setGenderFeatures({ ...genderFeatures, breastSize: v })}
                          />
                        </div>
                      ) : (
                        <>
                          <div className="space-y-1.5">
                            <div className="flex justify-between">
                              <Label className="text-xs">喉结大小</Label>
                              <span className="text-xs font-mono text-primary">{genderFeatures.adamsAppleSize ?? 30}</span>
                            </div>
                            <Slider
                              value={[genderFeatures.adamsAppleSize ?? 30]}
                              min={0}
                              max={100}
                              step={1}
                              onValueChange={([v]) => setGenderFeatures({ ...genderFeatures, adamsAppleSize: v })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex justify-between">
                              <Label className="text-xs">喉结明显程度</Label>
                              <span className="text-xs font-mono text-primary">{genderFeatures.adamsAppleProminence ?? 30}</span>
                            </div>
                            <Slider
                              value={[genderFeatures.adamsAppleProminence ?? 30]}
                              min={0}
                              max={100}
                              step={1}
                              onValueChange={([v]) => setGenderFeatures({ ...genderFeatures, adamsAppleProminence: v })}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Makeup Tab */}
              <TabsContent value="makeup">
                <Card className="bg-card border-border">
                  <CardContent className="p-6">
                    <h3 className="font-semibold mb-4">妆容编辑</h3>
                    <div className="space-y-5">
                      {MAKEUP_CONFIG.map(({ key, label }) => (
                        <div key={key} className="space-y-2">
                          <div className="flex justify-between">
                            <Label className="text-xs">{label}</Label>
                            <span className="text-xs font-mono text-primary">{makeup[key] ?? 0}</span>
                          </div>
                          <Slider
                            value={[makeup[key] ?? 0]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={([v]) => setMakeup({ ...makeup, [key]: v })}
                          />
                          {/* Color picker for applicable items */}
                          {key.includes("eyeshadow") || key.includes("blush") || key.includes("lip") ? (
                            <div className="flex gap-1.5 mt-1">
                              {MAKEUP_COLORS.map((color) => (
                                <button
                                  key={color}
                                  className={`w-5 h-5 rounded-full border transition-all hover:scale-110 active:scale-90 ${
                                    makeup[key.replace("Intensity", "Color")] === color
                                      ? "border-primary ring-2 ring-primary/30"
                                      : "border-border"
                                  }`}
                                  style={{ backgroundColor: color }}
                                  onClick={() => setMakeup({ ...makeup, [key.replace("Intensity", "Color")]: color })}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
}
