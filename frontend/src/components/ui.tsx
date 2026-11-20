import { Loader2, X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FLAG_LABELS, scoreHex, STATUS_META } from "../lib/format";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) {
  const v: Record<BtnVariant, string> = {
    primary:
      "text-white bg-gradient-to-b from-[#9b6dfb] to-[#7c4dea] shadow-[0_0_0_1px_rgb(139_92_246/0.6),0_8px_24px_-8px_rgb(139_92_246/0.7)] hover:brightness-110",
    secondary: "text-zinc-200 bg-white/[0.04] border border-line2 hover:bg-white/[0.08] hover:border-white/20",
    ghost: "text-mute hover:text-white hover:bg-white/[0.05]",
    danger: "text-bad bg-bad/10 border border-bad/25 hover:bg-bad/20",
    success: "text-ok bg-ok/10 border border-ok/25 hover:bg-ok/20",
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap",
        size === "sm" ? "h-8 px-3 text-[12.5px]" : "h-10 px-4 text-sm",
        v[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("card", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon, action }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="flex items-center gap-3 min-w-0">
        {icon && <div className="grid place-items-center size-8 rounded-lg bg-white/[0.04] border border-line text-accent">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-white tracking-tight">{title}</h3>
          {subtitle && <p className="text-[12.5px] text-mute mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

const tones: Record<string, string> = {
  ok: "bg-ok/10 text-ok border-ok/20",
  bad: "bg-bad/10 text-bad border-bad/20",
  warn: "bg-warn/10 text-warn border-warn/20",
  info: "bg-accent2/10 text-accent2 border-accent2/20",
  accent: "bg-accent/15 text-[#c4b5fd] border-accent/30",
  mute: "bg-white/[0.04] text-mute border-line2",
  hot: "bg-hot/10 text-hot border-hot/20",
};
export function Badge({ tone = "mute", children, className, dot }: { tone?: string; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone] || tones.mute, className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || { label: status, tone: "mute" };
  return (
    <Badge tone={m.tone} dot className={status === "analyzing" ? "animate-pulse" : ""}>
      {m.label}
    </Badge>
  );
}

export function FlagBadge({ flag }: { flag: string }) {
  const m = FLAG_LABELS[flag] || { label: flag, tone: "mute" };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function ReviewBadge({ status }: { status: string }) {
  const t = status === "approved" ? "ok" : status === "rejected" ? "bad" : "mute";
  return <Badge tone={t} dot>{status[0].toUpperCase() + status.slice(1)}</Badge>;
}

export function ScoreRing({ value, size = 56, stroke = 5 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const color = scoreHex(value);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(255 255 255 / 0.07)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)", filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-semibold text-white tabular-nums" style={{ fontSize: size * 0.3 }}>
          {Math.round(value)}
        </span>
      </div>
    </div>
  );
}

export function ScoreBar({ label, value, max, color, edited }: { label: string; value: number; max: number; color: string; edited?: boolean }) {
  return (
    <div>
      <div className="flex justify-between text-[11.5px] mb-1">
        <span className="text-mute">
          {label}
          {edited && <span className="ml-1 text-warn" title="Adjusted by an editor">•</span>}
        </span>
        <span className="text-zinc-300 tabular-nums">
          {Math.round(value * 10) / 10}
          <span className="text-dim">/{max}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(value / max) * 100}%`, background: color, boxShadow: `0 0 10px ${color}88` }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, icon, accent = "#8b5cf6", delay = 0 }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; accent?: string; delay?: number }) {
  return (
    <Card className="p-5 relative overflow-hidden animate-fade-up group hover:border-white/15 transition-colors" style={{ animationDelay: `${delay}ms` }}>
      <div className="absolute -right-8 -top-8 size-28 rounded-full blur-2xl opacity-20 group-hover:opacity-35 transition-opacity" style={{ background: accent }} />
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-mute font-medium">{label}</span>
        <span className="grid place-items-center size-8 rounded-lg border border-line bg-white/[0.03]" style={{ color: accent }}>
          {icon}
        </span>
      </div>
      <div className="mt-3 text-[28px] font-semibold tracking-tight text-white tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-[12px] text-mute">{sub}</div>}
    </Card>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="relative mb-4">
        <div className="absolute inset-0 blur-xl bg-accent/30 rounded-full" />
        <div className="relative grid place-items-center size-14 rounded-2xl border border-line2 bg-surface2 text-accent">{icon}</div>
      </div>
      <h4 className="text-white font-semibold">{title}</h4>
      {body && <p className="text-sm text-mute mt-1.5 max-w-md">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card border-bad/25 bg-bad/[0.04] p-4 text-sm text-bad flex items-center justify-between gap-3">
      <span className="whitespace-pre-wrap">{message}</span>
      {onRetry && (
        <Button size="sm" variant="danger" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, width = "max-w-3xl" }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fade-up_.2s_ease]" onClick={onClose} />
      <div className={cx("relative h-full w-full glass border-l border-line2 shadow-2xl flex flex-col animate-[slide-in_.28s_cubic-bezier(.2,.8,.2,1)]", width)}>
        <style>{`@keyframes slide-in{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}`}</style>
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-line">
          <div className="min-w-0">
            <div className="text-white font-semibold text-lg tracking-tight truncate">{title}</div>
            {subtitle && <div className="text-mute text-[13px] mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-mute hover:text-white hover:bg-white/5" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg card glass shadow-2xl animate-fade-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h3 className="font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-mute hover:text-white hover:bg-white/5" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Select({ value, onChange, children, className }: { value: string | number; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx("h-10 rounded-xl bg-white/[0.03] border border-line2 px-3 text-sm text-zinc-200 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 hover:border-white/20 transition", className)}
    >
      {children}
    </select>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx("h-10 rounded-xl bg-white/[0.03] border border-line2 px-3 text-sm text-zinc-200 placeholder:text-dim outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 hover:border-white/20 transition", props.className)}
    />
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative h-6 w-11 rounded-full transition-colors border disabled:opacity-40", checked ? "bg-accent border-accent" : "bg-white/[0.06] border-line2")}
    >
      <span className={cx("absolute top-0.5 size-[18px] rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7 animate-fade-up">
      <div>
        {eyebrow && <div className="text-[11px] uppercase tracking-[0.18em] text-accent2/80 font-semibold mb-2">{eyebrow}</div>}
        <h1 className="text-[26px] md:text-[30px] font-semibold tracking-tight text-white">{title}</h1>
        {description && <p className="text-mute mt-1.5 text-[14px] max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const chartTooltip = {
  contentStyle: {
    background: "rgba(19,19,29,.95)",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: 12,
    fontSize: 12,
    color: "#e7e7f0",
    boxShadow: "0 10px 30px -10px rgba(0,0,0,.6)",
  },
  labelStyle: { color: "#fff", fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: "#c9c9d9" },
};
