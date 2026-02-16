import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Database,
  HardDrive,
  Heart,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "wouter";
import { toast } from "sonner";

const MEMORY_TYPE_LABELS: Record<string, { label: string; icon: typeof Brain; color: string }> = {
  user_preference: { label: "用户偏好", icon: Heart, color: "text-pink-400" },
  key_fact: { label: "关键事实", icon: Star, color: "text-yellow-400" },
  emotional_pattern: { label: "情感模式", icon: Sparkles, color: "text-purple-400" },
  personality_trait: { label: "性格特征", icon: User, color: "text-blue-400" },
  conversation_summary: { label: "对话摘要", icon: Zap, color: "text-green-400" },
};

export default function AvatarMemory() {
  const { id } = useParams<{ id: string }>();
  const avatarId = parseInt(id || "0");
  const { user, loading: authLoading } = useAuth();

  const [searchQuery, setSearchQuery] = useState("");
  const [newMemoryType, setNewMemoryType] = useState<string>("user_preference");
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [newMemoryImportance, setNewMemoryImportance] = useState(0.8);
  const [showAddForm, setShowAddForm] = useState(false);

  // Queries
  const memoriesQuery = trpc.memory.list.useQuery(
    { avatarId },
    { enabled: !!user && avatarId > 0 }
  );
  const statsQuery = trpc.memory.stats.useQuery(
    { avatarId },
    { enabled: !!user && avatarId > 0 }
  );
  const cacheStatsQuery = trpc.cache.stats.useQuery(undefined, {
    enabled: !!user,
  });
  const searchResults = trpc.memory.search.useQuery(
    { avatarId, query: searchQuery, topK: 10 },
    { enabled: !!user && avatarId > 0 && searchQuery.length > 0 }
  );

  // Mutations
  const addMemory = trpc.memory.add.useMutation({
    onSuccess: () => {
      toast.success("记忆已添加");
      setNewMemoryContent("");
      setShowAddForm(false);
      memoriesQuery.refetch();
      statsQuery.refetch();
    },
    onError: (err) => toast.error(`添加失败: ${err.message}`),
  });

  const deleteMemory = trpc.memory.delete.useMutation({
    onSuccess: () => {
      toast.success("记忆已删除");
      memoriesQuery.refetch();
      statsQuery.refetch();
    },
    onError: (err) => toast.error(`删除失败: ${err.message}`),
  });

  const clearMemories = trpc.memory.clear.useMutation({
    onSuccess: () => {
      toast.success("所有记忆已清除");
      memoriesQuery.refetch();
      statsQuery.refetch();
    },
    onError: (err) => toast.error(`清除失败: ${err.message}`),
  });

  const clearCache = trpc.cache.clearAll.useMutation({
    onSuccess: (data) => {
      toast.success(`已清除 ${data.deleted} 条缓存`);
      cacheStatsQuery.refetch();
    },
    onError: (err) => toast.error(`清除失败: ${err.message}`),
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const memories = memoriesQuery.data || [];
  const stats = statsQuery.data;
  const cacheStats = cacheStatsQuery.data;
  const displayList = searchQuery.length > 0 ? (searchResults.data || []) : memories;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container flex items-center gap-4 h-16">
          <Link href="/">
            <Button variant="ghost" size="icon" className="hover:bg-accent/50 active:scale-95 transition-all">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold">记忆管理</h1>
          </div>
          <span className="text-sm text-muted-foreground">数字人 #{avatarId}</span>
        </div>
      </header>

      <div className="container py-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Memory Stats */}
          <Card className="bg-card/80 border-border/50 hover:border-primary/30 transition-all cursor-default">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                长期记忆
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {stats?.byType ? Object.entries(stats.byType).map(([type, count]) => (
                  <span key={type} className="mr-2">
                    {MEMORY_TYPE_LABELS[type]?.label || type}: {count}
                  </span>
                )) : "暂无记忆"}
              </div>
            </CardContent>
          </Card>

          {/* Cache Stats */}
          <Card className="bg-card/80 border-border/50 hover:border-primary/30 transition-all cursor-default">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-green-400" />
                模型缓存
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{cacheStats?.totalEntries || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {cacheStats?.totalSize
                  ? `${(cacheStats.totalSize / 1024 / 1024).toFixed(1)} MB`
                  : "0 MB"}
                {" · "}命中率 {cacheStats?.hitRate ? `${(cacheStats.hitRate * 100).toFixed(0)}%` : "0%"}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Card className="bg-card/80 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Database className="w-4 h-4 text-orange-400" />
                操作
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAddForm(!showAddForm)}
                className="hover:bg-primary/10 active:scale-95 transition-all"
              >
                <Plus className="w-3 h-3 mr-1" />
                添加记忆
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (confirm("确定要清除所有记忆吗？此操作不可撤销。")) {
                    clearMemories.mutate({ avatarId });
                  }
                }}
                className="hover:bg-destructive/10 text-destructive active:scale-95 transition-all"
                disabled={clearMemories.isPending}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                清除记忆
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (confirm("确定要清除所有模型缓存吗？")) {
                    clearCache.mutate();
                  }
                }}
                className="hover:bg-destructive/10 text-destructive active:scale-95 transition-all"
                disabled={clearCache.isPending}
              >
                <HardDrive className="w-3 h-3 mr-1" />
                清除缓存
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Add Memory Form */}
        {showAddForm && (
          <Card className="bg-card/80 border-primary/30">
            <CardHeader>
              <CardTitle className="text-base">手动添加记忆</CardTitle>
              <CardDescription>为数字人添加关于用户的记忆信息</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>记忆类型</Label>
                  <Select value={newMemoryType} onValueChange={setNewMemoryType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MEMORY_TYPE_LABELS).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>重要程度 ({newMemoryImportance.toFixed(1)})</Label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={newMemoryImportance}
                    onChange={(e) => setNewMemoryImportance(parseFloat(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>记忆内容</Label>
                <Textarea
                  placeholder="例如：用户喜欢蓝色，是一名软件工程师..."
                  value={newMemoryContent}
                  onChange={(e) => setNewMemoryContent(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    if (!newMemoryContent.trim()) {
                      toast.error("请输入记忆内容");
                      return;
                    }
                    addMemory.mutate({
                      avatarId,
                      type: newMemoryType as any,
                      content: newMemoryContent.trim(),
                      importance: newMemoryImportance,
                    });
                  }}
                  disabled={addMemory.isPending}
                  className="active:scale-95 transition-all"
                >
                  {addMemory.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                  保存
                </Button>
                <Button variant="ghost" onClick={() => setShowAddForm(false)} className="active:scale-95 transition-all">
                  取消
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索记忆（基于语义相似度）..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-card/80"
          />
        </div>

        <Separator />

        {/* Memory List */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {searchQuery ? `搜索结果 (${displayList.length})` : `全部记忆 (${memories.length})`}
          </h2>

          {memoriesQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : displayList.length === 0 ? (
            <Card className="bg-card/50 border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Brain className="w-12 h-12 mb-3 opacity-30" />
                <p>{searchQuery ? "未找到匹配的记忆" : "暂无记忆，与数字人对话后会自动积累"}</p>
              </CardContent>
            </Card>
          ) : (
            displayList.map((item: any) => {
              const typeInfo = MEMORY_TYPE_LABELS[item.type] || { label: item.type, icon: Brain, color: "text-gray-400" };
              const Icon = typeInfo.icon;

              return (
                <Card
                  key={item.id}
                  className="bg-card/80 border-border/50 hover:border-primary/30 transition-all group"
                >
                  <CardContent className="flex items-start gap-3 py-4">
                    <div className={`mt-0.5 ${typeInfo.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full bg-accent/50 ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                        {item.importance !== undefined && (
                          <span className="text-xs text-muted-foreground">
                            重要度: {(item.importance * 100).toFixed(0)}%
                          </span>
                        )}
                        {"similarity" in item && (
                          <span className="text-xs text-primary">
                            相似度: {((item as any).similarity * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <p className="text-sm">{item.content}</p>
                      {item.createdAt && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(item.createdAt).toLocaleString()}
                          {item.accessCount > 0 && ` · 被引用 ${item.accessCount} 次`}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive active:scale-95"
                      onClick={() => {
                        if (confirm("确定删除这条记忆？")) {
                          deleteMemory.mutate({ memoryId: item.id });
                        }
                      }}
                      disabled={deleteMemory.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Cache Details */}
        {cacheStats && cacheStats.totalEntries > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <HardDrive className="w-4 h-4" />
                模型缓存详情
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {Object.entries(cacheStats.byType).map(([type, info]) => (
                  <Card key={type} className="bg-card/80 border-border/50">
                    <CardContent className="py-3">
                      <div className="text-sm font-medium">{type}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {info.count} 条 · {(info.size / 1024 / 1024).toFixed(1)} MB · {info.hits} 次命中
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Warning */}
        <Card className="bg-yellow-500/5 border-yellow-500/20">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">关于长期记忆</p>
              <p>记忆会在对话过程中自动提取和积累。系统会分析对话内容，提取用户偏好、关键事实和情感模式。这些记忆会在后续对话中被检索并注入到数字人的回应中，使其更加个性化。您也可以手动添加或删除记忆。</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
