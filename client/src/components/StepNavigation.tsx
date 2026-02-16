import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export type Step = {
  id: string;
  label: string;
  path: string;
  icon?: React.ReactNode;
};

type StepNavigationProps = {
  steps: Step[];
  currentStep: string;
  avatarId?: number;
  onBack?: () => void;
  onNext?: () => void;
  canProceed?: boolean;
  isProcessing?: boolean;
};

export function StepNavigation({
  steps,
  currentStep,
  avatarId,
  onBack,
  onNext,
  canProceed = true,
  isProcessing = false,
}: StepNavigationProps) {
  const [, navigate] = useLocation();
  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="w-full">
      {/* Step indicators */}
      <div className="flex items-center justify-center gap-1 mb-6">
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPending = index > currentIndex;

          return (
            <div key={step.id} className="flex items-center">
              <button
                onClick={() => {
                  if (isCompleted && avatarId) {
                    navigate(step.path.replace(":id", String(avatarId)));
                  }
                }}
                className={`
                  flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold transition-all duration-300
                  ${isCompleted ? "step-completed text-background cursor-pointer" : ""}
                  ${isCurrent ? "step-active text-background" : ""}
                  ${isPending ? "step-pending text-muted-foreground" : ""}
                `}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
              </button>
              <span
                className={`ml-1.5 text-xs font-medium hidden sm:inline ${
                  isCurrent ? "text-primary" : isCompleted ? "text-neon-green" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
              {index < steps.length - 1 && (
                <div
                  className={`w-6 sm:w-10 h-0.5 mx-2 rounded transition-colors ${
                    isCompleted ? "bg-neon-green" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between items-center">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          disabled={currentIndex === 0 || isProcessing}
          className="gap-1"
        >
          <ChevronLeft className="w-4 h-4" />
          上一步
        </Button>
        <Button
          size="sm"
          onClick={onNext}
          disabled={!canProceed || isProcessing}
          className="gap-1"
        >
          {isProcessing ? "处理中..." : currentIndex === steps.length - 1 ? "完成" : "下一步"}
          {!isProcessing && <ChevronRight className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

export const AVATAR_CREATION_STEPS: Step[] = [
  { id: "upload", label: "上传图片", path: "/avatar/upload/:id" },
  { id: "skeleton", label: "骨架调整", path: "/avatar/:id/skeleton" },
  { id: "appearance", label: "外观定制", path: "/avatar/:id/appearance" },
  { id: "hair", label: "发型设计", path: "/avatar/:id/hair" },
  { id: "clothing", label: "服装选择", path: "/avatar/:id/clothing" },
  { id: "final", label: "最终渲染", path: "/avatar/:id/final" },
];
