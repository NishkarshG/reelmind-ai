import { Bot, CheckCircle2, Cpu, Download, FlaskConical, KeyRound, Lock, PlugZap, RefreshCw, RotateCcw, Save, SlidersHorizontal, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, cx, ErrorBox, Input, Modal, PageHeader, Select, Skeleton, Toggle } from "../components/ui";
import { api, post, put, STATIC_MODE } from "../lib/api";
import { useApi, useStore } from "../lib/store";
import type { ProviderStatus, Settings as S } from "../lib/types";

export default function Settings() {
  const { data, error, loading, setData } = useApi<{ settings: S; providers: ProviderStatus[] }>("/api/settings");
  const { workspace, toast, refresh, setWorkspace } = useStore();
  const [form, setForm] = useState<S | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [confirm, setConfirm] = useState<"clear" | "reset" | null>(null);
  const ro = workspace === "demo";

  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  useEffect(() => {
    setModels(null);
    setTestResult(null);
  }, [form?.provider]);

  if (error) return <ErrorBox message={error} onRetry={refresh} />;
  if (loading || !form || !data) return <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />)}</div>;
  const provider = data.providers.find((p) => p.id === form.provider);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const set = <K extends keyof S>(k: K, v: S[K]) => setForm({ ...form, [k]: v });
  const modelOptions = [...new Set([...(models || provider?.suggested_models || []), form.model].filter(Boolean))];

  const save = async () => {
    setSaving(true);
    try {
      const r = await put<{ settings: S; providers: ProviderStatus[] }>("/api/settings", form);
      setData(r);
      toast("ok", "Settings saved");
    } catch (e: any) {
      toast("err", "Could not save settings", e.message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await post<{ ok: boolean; message: string }>("/api/providers/test", { provider: form.provider, model: form.model });
      setTestResult(r);
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const r = await api<{ models: string[] }>(`/api/providers/${form.provider}/models`);
      setModels(r.models);
      toast("ok", `${r.models.length} models available`);
    } catch (e: any) {
      toast("err", "Could not list models", e.message);
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Studio configuration"
        description={ro ? "Demo workspace settings are read-only. Switch to Live to configure the engine." : "Configure the AI provider, analysis rules and export preferences for the live workspace."}
        actions={
          <Button variant="primary" icon={<Save className="size-4" />} disabled={ro || !dirty} loading={saving} onClick={save}>
            Save changes
          </Button>
        }
      />

      <div className="grid xl:grid-cols-2 gap-4">
        <Card className="animate-fade-up">
          <CardHeader title="AI provider" subtitle="Modular provider interface — add new providers in backend/app/ai" icon={<Bot className="size-4" />} />
          <div className="px-5 pb-5 space-y-3">
            {data.providers.map((p) => (
              <button
                key={p.id}
                disabled={ro}
                onClick={() => setForm({ ...form, provider: p.id, model: p.is_llm ? (data.settings.provider === p.id ? data.settings.model : p.suggested_models[0]) : p.suggested_models[0] })}
                className={cx("w-full text-left rounded-xl border p-4 transition flex items-start gap-3 disabled:cursor-not-allowed", form.provider === p.id ? "border-accent/60 bg-accent/[0.08] shadow-[0_0_0_3px_rgb(139_92_246/0.12)]" : "border-line hover:border-line2")}
              >
                <div className={cx("grid place-items-center size-9 rounded-lg border", p.is_llm ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-line2 text-mute")}>{p.is_llm ? <Cpu className="size-4" /> : <SlidersHorizontal className="size-4" />}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium text-[14px]">{p.label}</span>
                    {p.configured ? <Badge tone="ok" dot>Ready</Badge> : <Badge tone="bad" dot>Not configured</Badge>}
                  </div>
                  <div className="text-[12.5px] text-mute mt-1">
                    {p.is_llm ? "LLM analysis with strict JSON output; every candidate is validated against the screenplay." : "Deterministic keyword/structure scoring. Clearly labelled; never used as a silent fallback for failed LLM calls."}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="animate-fade-up">
          <CardHeader title="API key" subtitle="Stored only in server-side environment variables" icon={<KeyRound className="size-4" />} />
          <div className="px-5 pb-5">
            {provider?.is_llm ? (
              <>
                <div className="rounded-xl border border-line bg-black/25 p-4 flex items-center gap-3">
                  <Lock className="size-4 text-accent2" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[13px] text-white">{provider.env_var}</div>
                    <div className="text-[12px] text-mute">{provider.configured ? `Detected on server (${provider.key_hint ?? "set"})` : "Not set on the server"}</div>
                  </div>
                  {provider.configured ? <CheckCircle2 className="size-5 text-ok" /> : <XCircle className="size-5 text-bad" />}
                </div>
                <p className="text-[12.5px] text-mute mt-3 leading-relaxed">
                  For security the key is never entered in the browser or saved in the database. Add it to <code className="text-zinc-300">backend/.env</code> and restart the API:
                </p>
                <pre className="mt-2 text-[12px] font-mono bg-black/40 border border-line rounded-lg p-3 text-zinc-300 overflow-x-auto">{provider.env_var}=your-key-here</pre>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button icon={<PlugZap className="size-4" />} loading={testing} disabled={STATIC_MODE} onClick={test}>
                    Test connection
                  </Button>
                  <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={loadingModels} disabled={STATIC_MODE || !provider.configured} onClick={fetchModels}>
                    Fetch available models
                  </Button>
                </div>
                {testResult && (
                  <div className={cx("mt-3 rounded-xl border p-3 text-[12.5px] whitespace-pre-wrap break-words", testResult.ok ? "border-ok/30 bg-ok/[0.06] text-ok" : "border-bad/30 bg-bad/[0.06] text-bad")}>{testResult.message}</div>
                )}
              </>
            ) : (
              <div className="text-[13px] text-mute">The rule-based baseline runs entirely on the server and needs no API key.</div>
            )}
          </div>
        </Card>

        <Card className="animate-fade-up">
          <CardHeader title="Model & analysis" subtitle="Applied to the next analysis run" icon={<SlidersHorizontal className="size-4" />} />
          <div className="px-5 pb-5 grid sm:grid-cols-2 gap-4">
            <Field label="Model" hint={provider?.is_llm ? "Pick a suggestion or type any model id" : undefined} className="sm:col-span-2">
              {provider?.is_llm ? (
                <div className="flex gap-2">
                  <Select value={form.model} onChange={(v) => set("model", v)} className="flex-1">
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                  <Input disabled={ro} value={form.model} onChange={(e) => set("model", e.target.value)} className="flex-1 font-mono text-[12.5px]" aria-label="Custom model id" />
                </div>
              ) : (
                <Input disabled value={form.model} className="w-full" />
              )}
            </Field>
            <Field label={`Temperature · ${form.temperature}`}>
              <input type="range" min={0} max={1} step={0.1} disabled={ro} value={form.temperature} onChange={(e) => set("temperature", Number(e.target.value))} className="w-full accent-[#8b5cf6]" />
            </Field>
            <Field label="Max candidates per episode">
              <Input type="number" min={1} max={12} disabled={ro} value={form.max_candidates_per_episode} onChange={(e) => set("max_candidates_per_episode", Number(e.target.value))} className="w-full" />
            </Field>
            <Field label="Min clip duration (s)">
              <Input type="number" min={5} max={120} disabled={ro} value={form.min_duration_s} onChange={(e) => set("min_duration_s", Number(e.target.value))} className="w-full" />
            </Field>
            <Field label="Max clip duration (s)">
              <Input type="number" min={10} max={180} disabled={ro} value={form.max_duration_s} onChange={(e) => set("max_duration_s", Number(e.target.value))} className="w-full" />
            </Field>
            <div className="sm:col-span-2 flex items-center justify-between rounded-xl border border-line p-3">
              <div>
                <div className="text-[13px] text-white">Allow multi-segment promos</div>
                <div className="text-[12px] text-mute">Only when non-continuous cuts genuinely improve the story</div>
              </div>
              <Toggle checked={form.allow_multi_segment} disabled={ro} onChange={(v) => set("allow_multi_segment", v)} />
            </div>
          </div>
        </Card>

        <Card className="animate-fade-up">
          <CardHeader title="Quality thresholds" subtitle="Used to flag candidates on the evaluation page" icon={<SlidersHorizontal className="size-4" />} />
          <div className="px-5 pb-5 grid sm:grid-cols-3 gap-4">
            <Field label="Weak hook below (/30)">
              <Input type="number" min={0} max={30} disabled={ro} value={form.weak_hook_threshold} onChange={(e) => set("weak_hook_threshold", Number(e.target.value))} className="w-full" />
            </Field>
            <Field label="Weak cliffhanger below (/30)">
              <Input type="number" min={0} max={30} disabled={ro} value={form.weak_cliffhanger_threshold} onChange={(e) => set("weak_cliffhanger_threshold", Number(e.target.value))} className="w-full" />
            </Field>
            <Field label="Confusing if clarity below (/20)">
              <Input type="number" min={0} max={20} disabled={ro} value={form.confusing_clarity_threshold} onChange={(e) => set("confusing_clarity_threshold", Number(e.target.value))} className="w-full" />
            </Field>
          </div>
          <CardHeader title="Export settings" icon={<Download className="size-4" />} />
          <div className="px-5 pb-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-zinc-300">Include invalid candidates in full exports</span>
              <Toggle checked={form.export_include_invalid} disabled={ro} onChange={(v) => set("export_include_invalid", v)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-zinc-300">Include rejected candidates in full exports</span>
              <Toggle checked={form.export_include_rejected} disabled={ro} onChange={(v) => set("export_include_rejected", v)} />
            </div>
            <Field label="CSV delimiter">
              <Select value={form.csv_delimiter} onChange={(v) => set("csv_delimiter", v)}>
                <option value=",">Comma ( , )</option>
                <option value=";">Semicolon ( ; )</option>
                <option value={"\t"}>Tab</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="animate-fade-up xl:col-span-2">
          <CardHeader title="Workspaces" subtitle="Demo and live data live in separate SQLite databases and output folders" icon={<FlaskConical className="size-4" />} />
          <div className="px-5 pb-5 flex flex-wrap gap-2">
            <Button icon={<FlaskConical className="size-4" />} onClick={() => setWorkspace(workspace === "demo" ? "live" : "demo")} disabled={STATIC_MODE}>
              Switch to {workspace === "demo" ? "Live" : "Demo"} workspace
            </Button>
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} disabled={STATIC_MODE} onClick={() => setConfirm("reset")}>
              Reset demo data
            </Button>
            <Button variant="danger" icon={<Trash2 className="size-4" />} disabled={STATIC_MODE || ro} onClick={() => setConfirm("clear")}>
              Clear live workspace
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === "clear" ? "Clear the live workspace?" : "Reset demo data?"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm === "clear" ? "danger" : "primary"}
              onClick={async () => {
                try {
                  if (confirm === "clear") await post("/api/workspace/clear");
                  else await post("/api/demo/reset");
                  toast("ok", confirm === "clear" ? "Live workspace cleared" : "Demo data reset");
                  refresh();
                } catch (e: any) {
                  toast("err", "Action failed", e.message);
                }
                setConfirm(null);
              }}
            >
              {confirm === "clear" ? "Delete everything" : "Reset demo"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          {confirm === "clear"
            ? "This permanently deletes all live episodes, analysis runs, promo candidates and reviews. Settings are kept. This cannot be undone."
            : "Re-seeds the demo workspace from the bundled sample scripts using the rule-based baseline. Live data is not affected."}
        </p>
      </Modal>
    </>
  );
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <div className="text-[12.5px] text-mute mb-1.5">
        {label}
        {hint && <span className="text-dim"> · {hint}</span>}
      </div>
      {children}
    </label>
  );
}
