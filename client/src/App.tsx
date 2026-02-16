import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import AvatarUpload from "./pages/AvatarUpload";
import AvatarSkeleton from "./pages/AvatarSkeleton";
import AvatarAppearance from "./pages/AvatarAppearance";
import AvatarHair from "./pages/AvatarHair";
import AvatarClothing from "./pages/AvatarClothing";
import AvatarFinalRender from "./pages/AvatarFinalRender";
import AvatarChat from "./pages/AvatarChat";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      {/* 模块1: 图片上传与3D预览 */}
      <Route path="/avatar/upload" component={AvatarUpload} />
      <Route path="/avatar/upload/:id" component={AvatarUpload} />
      {/* 模块2: 骨架/五官/肤色/性别特征/妆容调整 */}
      <Route path="/avatar/:id/skeleton" component={AvatarSkeleton} />
      <Route path="/avatar/:id/appearance" component={AvatarAppearance} />
      {/* 模块3: 发型定制 */}
      <Route path="/avatar/:id/hair" component={AvatarHair} />
      {/* 模块4: 服装库 */}
      <Route path="/avatar/:id/clothing" component={AvatarClothing} />
      {/* 模块5: 最终渲染与导出 */}
      <Route path="/avatar/:id/final" component={AvatarFinalRender} />
      {/* 模块6: 3D数字人对话交互 */}
      <Route path="/avatar/:id/chat" component={AvatarChat} />
      <Route path="/avatar/:id/chat/:sessionId" component={AvatarChat} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
