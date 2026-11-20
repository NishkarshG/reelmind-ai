import {
  Activity,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clapperboard,
  FlaskConical,
  LayoutDashboard,
  Library,
  Loader2,
  Menu,
  Radio,
  Settings,
  Sparkles,
  X,
  XCircle,
  Info,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { STATIC_MODE } from "../lib/api";
import { useStore } from "../lib/store";
import { cx } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/episodes", label: "Episode Library", icon: Library },
  { to: "/promos", label: "Promo Discovery", icon: Sparkles },
  { to: "/scenes", label: "Scene Intelligence", icon: Clapperboard },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/evaluation", label: "Quality Evaluation", icon: ClipboardCheck },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative size-9 rounded-xl grid place-items-center bg-gradient-to-br from-accent/30 to-accent2/20 border border-white/10 shadow-[0_0_24px_-4px_rgb(139_92_246/0.6)]">
        <svg viewBox="0 0 32 32" className="size-6">
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#c4b5fd" />
              <stop offset="1" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="10" fill="none" stroke="url(#lg)" strokeWidth="2.4" />
          <circle cx="16" cy="16" r="2.6" fill="url(#lg)" />
          {[0, 90, 180, 270].map((a) => (
            <circle key={a} cx={16 + 5.6 * Math.cos((a * Math.PI) / 180)} cy={16 + 5.6 * Math.sin((a * Math.PI) / 180)} r="1.7" fill="url(#lg)" />
          ))}
        </svg>
      </div>
      <div className="leading-none">
        <div className="font-extrabold tracking-[0.14em] text-[14px] text-white">
          REELMIND<span className="grad-text ml-1">AI</span>
        </div>
        <div className="text-[10.5px] text-mute mt-1 tracking-wide">Promo Intelligence Studio</div>
      </div>
    </div>
  );
}

function WorkspaceSwitch() {
  const { workspace, setWorkspace } = useStore();
  return (
    <div className="rounded-xl border border-line bg-black/20 p-1 grid grid-cols-2 text-[12px] font-medium">
      {(["live", "demo"] as const).map((w) => (
        <button
          key={w}
          disabled={STATIC_MODE && w === "live"}
          title={STATIC_MODE && w === "live" ? "Live workspace needs the Python backend" : undefined}
          onClick={() => setWorkspace(w)}
          className={cx(
            "h-8 rounded-lg flex items-center justify-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed",
            workspace === w
              ? w === "demo"
                ? "bg-warn/15 text-warn shadow-inner"
                : "bg-accent/20 text-white shadow-inner"
              : "text-mute hover:text-white",
          )}
        >
          {w === "live" ? <Radio className="size-3.5" /> : <FlaskConical className="size-3.5" />}
          {w === "live" ? "Live" : "Demo"}
        </button>
      ))}
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { backendOnline } = useStore();
  return (
    <aside className="h-full w-[248px] shrink-0 bg-side border-r border-line flex flex-col">
      <div className="px-5 pt-5 pb-6">
        <Logo />
      </div>
      <div className="px-4 mb-4">
        <div className="text-[10.5px] uppercase tracking-[0.16em] text-dim font-semibold mb-2 px-1">Workspace</div>
        <WorkspaceSwitch />
      </div>
      <nav className="px-3 space-y-0.5 flex-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                "group relative flex items-center gap-3 rounded-xl px-3 h-10 text-[13.5px] font-medium transition-all",
                isActive ? "text-white bg-white/[0.06]" : "text-mute hover:text-white hover:bg-white/[0.03]",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-gradient-to-b from-accent to-accent2" />}
                <Icon className={cx("size-[17px] transition-colors", isActive ? "text-accent" : "text-dim group-hover:text-zinc-300")} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="p-4">
        <div className="rounded-xl border border-line bg-white/[0.02] p-3 text-[11.5px]">
          <div className="flex items-center gap-2 text-zinc-300 font-medium">
            <span className={cx("size-2 rounded-full", STATIC_MODE ? "bg-warn" : backendOnline ? "bg-ok shadow-[0_0_8px_#34d399]" : backendOnline === false ? "bg-bad" : "bg-dim")} />
            {STATIC_MODE ? "Static preview" : backendOnline ? "Engine online" : backendOnline === false ? "Engine offline" : "Connecting…"}
          </div>
          <div className="text-dim mt-1 leading-relaxed">
            {STATIC_MODE ? "Read-only demo snapshot. Run the backend for live analysis." : "FastAPI · SQLite · Gemini"}
          </div>
        </div>
      </div>
    </aside>
  );
}

function JobPill() {
  const { job } = useStore();
  const [hide, setHide] = useState(false);
  useEffect(() => setHide(false), [job?.id, job?.status]);
  if (!job || hide) return null;
  const running = job.status === "running" || job.status === "queued";
  const pct = job.total ? Math.round((job.progress / job.total) * 100) : 0;
  if (!running && job.finished_at && Date.now() - new Date(job.finished_at).getTime() > 60000) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line2 bg-surface2/80 pl-3 pr-2 h-9 text-[12px] min-w-0">
      {running ? <Loader2 className="size-3.5 text-accent animate-spin shrink-0" /> : job.status === "completed" ? <CheckCircle2 className="size-3.5 text-ok shrink-0" /> : <XCircle className="size-3.5 text-bad shrink-0" />}
      <span className="text-zinc-300 truncate max-w-[260px]">{job.message}</span>
      {running && (
        <div className="w-24 h-1.5 rounded-full bg-white/[0.07] overflow-hidden shrink-0">
          <div className="h-full bg-gradient-to-r from-accent to-accent2 transition-all" style={{ width: `${Math.max(6, pct)}%` }} />
        </div>
      )}
      {!running && (
        <button className="text-dim hover:text-white" onClick={() => setHide(true)} aria-label="Dismiss">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2.5rem)]">
      {toasts.map((t) => (
        <div key={t.id} className="glass rounded-xl p-3.5 shadow-2xl animate-fade-up flex gap-3">
          {t.kind === "ok" ? <CheckCircle2 className="size-4 text-ok mt-0.5 shrink-0" /> : t.kind === "err" ? <XCircle className="size-4 text-bad mt-0.5 shrink-0" /> : <Info className="size-4 text-accent2 mt-0.5 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-white">{t.title}</div>
            {t.body && <div className="text-[12px] text-mute mt-0.5 whitespace-pre-wrap break-words">{t.body}</div>}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-dim hover:text-white self-start" aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { workspace, setWorkspace } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  const current = NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)));
  return (
    <div className="backdrop h-full flex">
      <div className="hidden lg:block relative z-10">
        <Sidebar />
      </div>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="relative animate-fade-up">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <div className="relative z-10 flex-1 min-w-0 flex flex-col h-full">
        <header className="h-14 shrink-0 border-b border-line flex items-center gap-3 px-4 md:px-8 bg-ink/60 backdrop-blur-md sticky top-0 z-20">
          <button className="lg:hidden p-2 -ml-2 text-mute hover:text-white" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2 text-[13px] min-w-0">
            <span className="text-dim hidden sm:inline">Studio</span>
            <span className="text-dim hidden sm:inline">/</span>
            <span className="text-zinc-200 font-medium truncate">{current?.label}</span>
          </div>
          <div className="ml-auto flex items-center gap-3 min-w-0">
            <JobPill />
            <div className="hidden md:flex items-center gap-1.5 text-[12px] text-mute">
              <Activity className="size-3.5" /> Editorial promo-potential scores
            </div>
          </div>
        </header>
        {workspace === "demo" && (
          <div className="shrink-0 border-b border-warn/20 bg-gradient-to-r from-warn/[0.09] via-warn/[0.04] to-transparent px-4 md:px-8 py-2 text-[12.5px] text-warn flex items-center gap-2">
            <FlaskConical className="size-3.5 shrink-0" />
            <span className="min-w-0">
              <b className="font-semibold">DEMO MODE</b> — sample scripts analysed by the offline rule-based baseline. Demo data is stored separately and never mixed with live results.
            </span>
            {!STATIC_MODE && (
              <button className="ml-auto underline underline-offset-2 hover:text-white shrink-0" onClick={() => setWorkspace("live")}>
                Switch to Live
              </button>
            )}
          </div>
        )}
        <main key={loc.pathname + workspace} className="flex-1 overflow-y-auto scroll-thin">
          <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-7 md:py-9">{children}</div>
        </main>
      </div>
      <Toasts />
    </div>
  );
}
