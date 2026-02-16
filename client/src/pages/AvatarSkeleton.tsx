import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { StepNavigation, AVATAR_CREATION_STEPS } from "@/components/StepNavigation";
import { AvatarPreview3D } from "@/components/AvatarPreview3D";
import { useLocation, useParams } from "wouter";
import { useState, useEffect } from "react";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

type SkeletonParams = {
  height: number;
  shoulderWidth: number;
  hipHeight: number;
  hipWidth: number;
  armLength: number;
  legLength: number;
  torsoLength: number;
  neckLength: number;
};

const DEFAULT_SKELETON: SkeletonParams = {
  height: 170, shoulderWidth: 40, hipHeight: 90, hipWidth: 35,
  armLength: 60, legLength: 80, torsoLength: 50, neckLength: 10,
};

const PARAM_CONFIG: { key: keyof SkeletonParams; label: string; min: number; max: number; unit: string }[] = [
  { key: "height", label: "身高", min: 140, max: 210, unit: "cm" },
  { key: "shoulderWidth", label: "肩宽", min: 25, max: 55, unit: "cm" },
  { key: "hipHeight", label: "胯骨高度", min: 70, max: 110, unit: "cm" },
  { key: "hipWidth", label: "胯骨宽度", min: 25, max: 50, unit: "cm" },
  { key: "armLength", label: "臂长", min: 40, max: 80, unit: "cm" },
  { key: "legLength", label: "腿长", min: 60, max: 100, unit: "cm" },
  { key: "torsoLength", label: "躯干长度", min: 35, max: 65, unit: "cm" },
  { key: "neckLength", label: "颈部长度", min: 5, max: 18, unit: "cm" },
];

export default function AvatarSkeleton() {
  useAuth({ redirectOnUnauthenticated: true });
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const avatarId = parseInt(params.id);

  const avatarQuery = trpc.avatar.get.useQuery({ id: avatarId });
  const updateMutation = trpc.avatar.update.useMutation();
  const saveStepMutation = trpc.avatar.saveStep.useMutation();

  const [skeleton, setSkeleton] = useState<SkeletonParams>(DEFAULT_SKELETON);

  useEffect(() => {
    if (avatarQuery.data?.skeletonParams) {
      setSkeleton(avatarQuery.data.skeletonParams as SkeletonParams);
    }
  }, [avatarQuery.data]);

  const handleParamChange = (key: keyof SkeletonParams, value: number) => {
    setSkeleton((prev) => ({ ...prev, [key]: value }));
  };

  const handleNext = async () => {
    try {
      // Save step snapshot for rollback
      await saveStepMutation.mutateAsync({
        avatarId,
        stepName: "skeleton",
        paramsSnapshot: { skeletonParams: skeleton },
        stepOrder: 1,
      });
      // Update avatar
      await updateMutation.mutateAsync({
        id: avatarId,
        skeletonParams: skeleton,
        currentStep: "appearance",
      });
      navigate(`/avatar/${avatarId}/appearance`);
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
          <h1 className="font-bold gradient-text">骨架调整</h1>
        </div>
      </header>

      <main className="container py-8 max-w-6xl mx-auto">
        <div className="mb-8">
          <StepNavigation
            steps={AVATAR_CREATION_STEPS}
            currentStep="skeleton"
            avatarId={avatarId}
            onBack={() => navigate(`/avatar/upload/${avatarId}`)}
            onNext={handleNext}
            isProcessing={updateMutation.isPending || saveStepMutation.isPending}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 3D Preview */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <AvatarPreview3D
              skeletonParams={skeleton}
              skinColor={avatarQuery.data?.skinParams as any || undefined}
              gender={avatarQuery.data?.gender || "female"}
            />
          </div>

          {/* Controls */}
          <div>
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold">骨架参数</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setSkeleton(DEFAULT_SKELETON)}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    重置
                  </Button>
                </div>

                <div className="space-y-5">
                  {PARAM_CONFIG.map(({ key, label, min, max, unit }) => (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">{label}</Label>
                        <span className="text-sm font-mono text-primary">
                          {skeleton[key]}{unit}
                        </span>
                      </div>
                      <Slider
                        value={[skeleton[key]]}
                        min={min}
                        max={max}
                        step={1}
                        onValueChange={([v]) => handleParamChange(key, v)}
                        className="cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{min}{unit}</span>
                        <span>{max}{unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
