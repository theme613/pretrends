"use client";

import React, { useState } from "react";
import { DashboardShell, DashboardButton } from "@/components/block/dashboard-shell";
import { ActiveSessions, type ActiveSession } from "@/components/block/active-sessions";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Activity, Bell, Search, TrendingUp, Zap, Cpu, Flame, Target } from "lucide-react";

const INITIAL_BOTS: ActiveSession[] = [
  { id: "b1", name: "Reddit Crawler Node A", device: "laptop", location: "us-east-1", ip: "10.0.1.24", lastActiveAt: new Date(Date.now() - 1000).toISOString(), current: true, flag: "Active" },
  { id: "b2", name: "Twitter Stream Processor", device: "laptop", location: "eu-west-2", ip: "10.1.5.11", lastActiveAt: new Date(Date.now() - 5000).toISOString() },
  { id: "b3", name: "HackerNews Digest AI", device: "laptop", location: "us-west-1", ip: "10.2.1.88", lastActiveAt: new Date(Date.now() - 12000).toISOString() },
  { id: "b4", name: "GitHub Trending Scanner", device: "laptop", location: "ap-south-1", ip: "10.4.0.12", lastActiveAt: new Date(Date.now() - 45000).toISOString(), flag: "Throttled" },
];

const BREAKOUTS = [
  { rank: 1, name: "Agentic UIs", categories: ["saas"], status: "Heating Up", score: 85 },
  { rank: 2, name: "DeSci Protocols", categories: ["crypto"], status: "About to Peak", score: 92 },
  { rank: 3, name: "Rust in Frontend", categories: ["devtools", "saas"], status: "Heating Up", score: 65 },
  { rank: 4, name: "O1-style Reasoning", categories: ["saas"], status: "About to Peak", score: 99 },
  { rank: 5, name: "Edge Inference", categories: ["hardware"], status: "Emerging", score: 45 },
];

const CATEGORIES = [
  { id: "music", label: "Music" },
  { id: "dance", label: "Dance" },
  { id: "meme", label: "Meme" },
  { id: "car", label: "Car" },
  { id: "game", label: "Game" },
  { id: "food", label: "Food" },
  { id: "fashion", label: "Fashion" },
  { id: "sports", label: "Sports" },
  { id: "saas", label: "SaaS" },
  { id: "crypto", label: "Crypto" },
];

function HeatIndicator({ level }: { level: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-1">
      <div className={`h-3 w-1.5 rounded-sm ${level >= 1 ? 'bg-orange-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
      <div className={`h-3 w-1.5 rounded-sm ${level >= 2 ? 'bg-orange-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
      <div className={`h-3 w-1.5 rounded-sm ${level >= 3 ? 'bg-red-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
    </div>
  );
}

export default function TrendRadarDashboard() {
  const [activeItemId, setActiveItemId] = useState("radar");
  const [bots, setBots] = useState<ActiveSession[]>(INITIAL_BOTS);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [trends, setTrends] = useState(BREAKOUTS);

  React.useEffect(() => {
    const fetchTrends = async () => {
      try {
        const query = selectedCategories.length > 0 ? `?categories=${selectedCategories.join(',')}` : '';
        const res = await fetch(`/api/trends${query}`);
        if (res.ok) {
          const data = await res.json();
          // Map to local format if needed
          setTrends(data.map((item: any, i: number) => ({
            rank: i + 1,
            name: item.name || item.trend_name,
            categories: item.categories || [],
            status: item.status || "Emerging",
            score: item.breakout_score || item.score || 0
          })));
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchTrends();
  }, [selectedCategories]);

  const toggleCategory = (catId: string) => {
    setSelectedCategories(prev => 
      prev.includes(catId) ? prev.filter(c => c !== catId) : [...prev, catId]
    );
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      <DashboardButton variant="ghost" aria-label="Search">
        <Search size={18} />
      </DashboardButton>
      <DashboardButton variant="ghost" aria-label="Notifications">
        <Bell size={18} />
      </DashboardButton>
      <Avatar className="h-8 w-8 ml-2 border cursor-pointer shrink-0">
        <AvatarImage src="https://i.pravatar.cc/150?u=a042581f4e29026704d" alt="@user" />
        <AvatarFallback>TR</AvatarFallback>
      </Avatar>
    </div>
  );

  return (
    <DashboardShell
      brand={{ name: "TrendRadar", logo: <Zap className="text-blue-500" /> }}
      navigation={[
        {
          id: "main",
          title: "Dashboard",
          items: [
            { id: "radar", label: "Live Radar", icon: Activity },
            { id: "predictions", label: "Predictions", icon: TrendingUp },
            { id: "sources", label: "Data Sources", icon: Cpu },
          ]
        }
      ]}
      secondaryNavigation={[
        { id: "settings", label: "Settings", icon: Target }
      ]}
      activeItemId={activeItemId}
      onActiveItemChange={setActiveItemId}
      title="Live Radar"
      status="Live"
      statusTone="success"
      headerActions={headerActions}
      className="bg-background"
    >
      <div className="flex flex-col gap-8 p-6 max-w-[1440px] mx-auto">
        
        {/* Category Multi-select Row */}
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategories.includes(cat.id);
            return (
              <Badge 
                key={cat.id}
                variant={isSelected ? "default" : "secondary"}
                className={`cursor-pointer px-4 py-1.5 text-sm rounded-full transition-colors ${isSelected ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-none'}`}
                onClick={() => toggleCategory(cat.id)}
              >
                {cat.label}
              </Badge>
            );
          })}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          
          {/* Left Column: Breakout Ranking */}
          <div className="xl:col-span-2 space-y-8">
            <Card className="shadow-sm border-none rounded-2xl">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-semibold flex items-center gap-2 text-slate-800">
                  <Flame className="text-orange-500" size={24} />
                  Breakout Ranking
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-b-slate-100 hover:bg-transparent">
                      <TableHead className="w-12 font-medium text-slate-400">#</TableHead>
                      <TableHead className="font-medium text-slate-400">Trend</TableHead>
                      <TableHead className="font-medium text-slate-400">Categories</TableHead>
                      <TableHead className="w-32 font-medium text-slate-400">Peak Prediction</TableHead>
                      <TableHead className="w-48 font-medium text-slate-400">Heat Indicator</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trends.map((trend) => (
                      <TableRow key={trend.id || trend.name} className="border-b-slate-50/50 hover:bg-slate-50/50 transition-colors">
                        <TableCell className="font-semibold text-slate-500">{trend.rank}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <a href={trend.url || "#"} target="_blank" rel="noreferrer" className="font-semibold text-slate-800 text-base hover:underline flex items-center gap-2">
                              {trend.name || trend.title}
                              {!trend.url && <Badge variant="outline" className="text-[10px] h-4 px-1">Demo</Badge>}
                            </a>
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                              <Avatar className="h-4 w-4"><AvatarFallback>{(trend.creator?.[0] || '?').toUpperCase()}</AvatarFallback></Avatar>
                              <span>{trend.creator || 'Unknown'}</span>
                              <span>•</span>
                              <span>{trend.platform || 'Web'}</span>
                            </div>
                            <p className="text-xs text-slate-400 italic">"{trend.reason || 'Growing steadily across platforms.'}"</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {trend.categories.map((c: string) => (
                              <Badge key={c} variant="secondary" className="bg-slate-100 text-slate-600 font-medium border-none capitalize">{c}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-medium text-slate-600">
                          {trend.score > 80 ? "1-2 days" : trend.score > 50 ? "3-5 days" : "1 week+"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <HeatIndicator level={trend.score > 90 ? 3 : trend.score > 70 ? 2 : 1} />
                            <Badge 
                              className={trend.status === 'Heating Up' ? 'bg-orange-100 text-orange-700 hover:bg-orange-200 border-none' : trend.status === 'About to Peak' ? 'bg-red-100 text-red-700 hover:bg-red-200 border-none' : 'bg-slate-100 text-slate-600 border-none hover:bg-slate-200'}
                            >
                              {trend.status}
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Dark Spotlight Card */}
            <Card className="rounded-2xl border-none bg-slate-900 text-slate-50 shadow-lg overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 to-purple-600/20 pointer-events-none" />
              <CardHeader className="relative z-10">
                <CardTitle className="text-xl flex items-center gap-2 text-blue-400">
                  <Zap size={24} className="animate-pulse" />
                  About to Peak
                </CardTitle>
                <CardDescription className="text-slate-400">High confidence signals detected in the last 24 hours.</CardDescription>
              </CardHeader>
              <CardContent className="relative z-10">
                <div className="flex items-center justify-between p-5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
                  <div>
                    <h4 className="font-bold text-white text-xl">O1-style Reasoning</h4>
                    <p className="text-slate-300 mt-1">Velocity increased by 400% across technical subreddits.</p>
                  </div>
                  <Badge className="bg-blue-500 hover:bg-blue-600 text-white text-sm px-4 py-1.5 border-none">Peak Imminent</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Bot Scan / Activity */}
          <div className="xl:col-span-1 space-y-8">
            <Card className="shadow-sm rounded-2xl border-none h-full flex flex-col bg-white">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl flex items-center gap-2 text-slate-800">
                  <Cpu className="text-indigo-500" size={24} />
                  Live Bot Scan
                </CardTitle>
                <CardDescription>Active crawler nodes hunting for signals.</CardDescription>
              </CardHeader>
              <CardContent className="p-0 flex-1">
                <ActiveSessions 
                  sessions={bots} 
                  onSessionsChange={setBots}
                  className="border-none shadow-none rounded-none p-4 bg-transparent"
                />
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </DashboardShell>
  );
}
