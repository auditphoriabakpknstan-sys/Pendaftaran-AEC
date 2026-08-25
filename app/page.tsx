"use client"

import { useRef, useState } from "react"
import {
  FileText,
  Users,
  User,
  Building2,
  MapPin,
  Phone,
  Mail,
  ShieldCheck,
  Upload,
  CheckCircle2,
  X,
  Link as LinkIcon,
} from "lucide-react"
import { COMMON_FILE_FIELDS, PAYMENT_FIELD, getKategoriConfig } from "@/lib/kategori-config"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB — aman, upload langsung ke Blob, bukan lewat Vercel Function

// NEXT_PUBLIC_ wajib supaya nilainya ke-bundle ke browser saat build.
// Isi sesuai kategori project ini: AEC / ARC / AICE / AVOC / LCCA
const kategori = getKategoriConfig(process.env.NEXT_PUBLIC_LOMBA_KATEGORI)

function generateReferenceId() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  const date = new Date()
  const y = date.getFullYear().toString().slice(-2)
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${kategori.code}-${y}${m}${d}-${rand}`
}

type MultiFiles = Record<string, File[]>

export default function DaftarPage() {
  // --- Data peserta/tim ---
  const [namaTim, setNamaTim] = useState("")
  const [ketua, setKetua] = useState("")
  const [anggota1, setAnggota1] = useState("")
  const [anggota2, setAnggota2] = useState("")
  const [sekolah, setSekolah] = useState("")
  const [kota, setKota] = useState("")
  const [telepon, setTelepon] = useState("")
  const [email, setEmail] = useState("")
  const [pakta, setPakta] = useState(false)
  const [honeypot, setHoneypot] = useState("")
  const formLoadedAt = useRef(Date.now())

  // --- Karya ---
  const [karyaFile, setKaryaFile] = useState<File | null>(null)
  const [karyaLink, setKaryaLink] = useState("")

  // --- Berkas umum + bukti bayar ---
  const [commonFiles, setCommonFiles] = useState<MultiFiles>(() =>
    Object.fromEntries(COMMON_FILE_FIELDS.map((f) => [f.key, [] as File[]])),
  )
  const [buktiBayar, setBuktiBayar] = useState<File[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [phase, setPhase] = useState<"" | "uploading" | "saving">("")
  const [progress, setProgress] = useState("")
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [referenceId, setReferenceId] = useState("")

  function updateCommonFiles(key: string, files: File[]) {
    const oversized = files.find((f) => f.size > MAX_FILE_SIZE)
    if (oversized) {
      setMessage({ type: "error", text: `Berkas "${oversized.name}" melebihi 10MB.` })
      return
    }
    setCommonFiles((prev) => ({ ...prev, [key]: files }))
  }

  function validate(): string | null {
    if (kategori.teamMode === "optional" && !ketua.trim()) return "Nama ketua/peserta wajib diisi."
    if (kategori.teamMode === "individu" && !ketua.trim()) return "Nama lengkap peserta wajib diisi."
    if (kategori.teamMode === "wajib3") {
      if (!namaTim.trim()) return "Nama tim wajib diisi."
      if (!ketua.trim()) return "Nama ketua tim wajib diisi."
      if (!anggota1.trim()) return "Kategori ini wajib 3 orang — nama anggota 1 wajib diisi."
      if (!anggota2.trim()) return "Kategori ini wajib 3 orang — nama anggota 2 wajib diisi."
    }
    if (!sekolah.trim()) return "Asal sekolah/universitas wajib diisi."
    if (!kota.trim()) return "Kota asal wajib diisi."
    if (!telepon.trim() || !/^[0-9+\s-]{8,}$/.test(telepon.trim())) return "Nomor telepon tidak valid."
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Format email tidak valid."
    if (!pakta) return "Anda harus menyetujui pakta integritas."

    if ((kategori.karyaType === "file" || kategori.karyaType === "file+link") && !karyaFile) {
      return `${kategori.karyaFileLabel ?? "Berkas karya"} wajib diunggah.`
    }
    if ((kategori.karyaType === "link" || kategori.karyaType === "file+link") && !karyaLink.trim()) {
      return `${kategori.karyaLinkLabel ?? "Link karya"} wajib diisi.`
    }

    for (const f of COMMON_FILE_FIELDS) {
      if (commonFiles[f.key].length === 0) return `Berkas "${f.label}" wajib diunggah.`
    }
    if (buktiBayar.length === 0) return "Bukti pembayaran wajib diunggah."

    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setMessage({ type: "error", text: validationError })
      return
    }

    setSubmitting(true)
    setMessage(null)
    const newReferenceId = generateReferenceId()

    try {
      setPhase("uploading")
      const { upload } = await import("@vercel/blob/client")

      const filesToUpload: MultiFiles = { ...commonFiles, buktiBayar }
      if (karyaFile) filesToUpload.karyaFile = [karyaFile]

      let uploaded = 0
      const total = Object.values(filesToUpload).reduce((sum, list) => sum + list.length, 0)

      const entries = await Promise.all(
        Object.entries(filesToUpload).map(async ([key, list]) => {
          const urls = await Promise.all(
            list.map(async (file) => {
              const blob = await upload(`pendaftaran/${newReferenceId}/${key}-${file.name}`, file, {
                access: "public",
                handleUploadUrl: "/api/blob-upload",
              })
              uploaded += 1
              setProgress(`${uploaded}/${total}`)
              return blob.url
            }),
          )
          return [key, urls] as const
        }),
      )
      const fileUrls: Record<string, string[]> = Object.fromEntries(entries)

      setPhase("saving")
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceId: newReferenceId,
          namaTim,
          ketua,
          anggota1,
          anggota2,
          sekolah,
          kota,
          telepon,
          email,
          pakta: String(pakta),
          karyaLink,
          fileUrls,
          website: honeypot,
          formLoadedAt: formLoadedAt.current,
        }),
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setMessage({ type: "error", text: data.message ?? "Pendaftaran gagal dikirim. Coba lagi." })
        return
      }

      setReferenceId(newReferenceId)
      setMessage({ type: "success", text: "Pendaftaran berhasil dikirim!" })
    } catch (err) {
      setMessage({
        type: "error",
        text:
          err instanceof Error && err.message
            ? err.message
            : "Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi (berkas yang sudah dipilih tidak hilang).",
      })
    } finally {
      setSubmitting(false)
      setPhase("")
      setProgress("")
    }
  }

  if (referenceId && message?.type === "success") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-xl text-center">
          <div className="relative overflow-hidden bg-primary px-8 py-10">
            <div className="absolute -right-8 -top-8 size-40 rounded-full bg-primary-foreground/10" aria-hidden="true" />
            <div className="relative">
              <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary-foreground/15">
                <CheckCircle2 className="size-9 text-primary-foreground" aria-hidden="true" />
              </div>
              <h1 className="text-2xl font-bold text-primary-foreground">Pendaftaran Terkirim!</h1>
              <p className="mt-1 text-sm text-primary-foreground/80">{kategori.fullName}</p>
            </div>
          </div>
          <div className="px-8 py-8">
            <p className="font-mono text-sm text-muted-foreground">No. Referensi</p>
            <p className="font-mono text-lg font-semibold">{referenceId}</p>
            <p className="mt-4 text-xs text-muted-foreground">Simpan nomor referensi ini untuk keperluan konfirmasi.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 md:py-16">
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-xl shadow-primary/5">
        {/* Header */}
        <header className="relative overflow-hidden bg-primary px-6 py-8 md:px-10">
          <div className="absolute -right-8 -top-8 size-40 rounded-full bg-primary-foreground/10" aria-hidden="true" />
          <div className="absolute -bottom-12 -left-6 size-40 rounded-full bg-accent/20" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-3 py-1 text-xs font-semibold text-primary-foreground">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Pendaftaran Dibuka
            </span>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <FileText className="size-6" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-2xl font-bold leading-tight text-primary-foreground md:text-3xl">Auditphoria 6.0</h1>
                <p className="text-sm text-primary-foreground/80">{kategori.fullName}</p>
              </div>
            </div>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="space-y-8 px-6 py-8 md:px-10">
          {/* honeypot anti-bot */}
          <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0" aria-hidden="true">
            <label htmlFor="website">Jangan isi field ini</label>
            <input id="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </div>

          <Section number="1" title="Data Peserta">
            {kategori.teamMode === "wajib3" && (
              <Field label="Nama Tim" required icon={<Users className="size-4" />}>
                <input type="text" value={namaTim} onChange={(e) => setNamaTim(e.target.value)} className={inputClass} />
              </Field>
            )}
            {kategori.teamMode === "optional" && (
              <Field label="Nama Tim" hint="Opsional — kosongkan kalau daftar sendiri" icon={<Users className="size-4" />}>
                <input type="text" value={namaTim} onChange={(e) => setNamaTim(e.target.value)} className={inputClass} />
              </Field>
            )}

            <Field
              label={kategori.teamMode === "individu" ? "Nama Lengkap Peserta" : "Nama Ketua Tim"}
              required
              icon={<User className="size-4" />}
            >
              <input type="text" value={ketua} onChange={(e) => setKetua(e.target.value)} className={inputClass} />
            </Field>

            {kategori.teamMode !== "individu" && (
              <div className="rounded-2xl border border-dashed border-border bg-secondary/40 p-4">
                <p className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Users className="size-4" aria-hidden="true" />
                  {kategori.teamMode === "wajib3" ? "Anggota tim (wajib 2 orang, total 3 dengan ketua)" : "Anggota tim opsional"}
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Nama Anggota 1" required={kategori.teamMode === "wajib3"} icon={<User className="size-4" />}>
                    <input type="text" value={anggota1} onChange={(e) => setAnggota1(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Nama Anggota 2" required={kategori.teamMode === "wajib3"} icon={<User className="size-4" />}>
                    <input type="text" value={anggota2} onChange={(e) => setAnggota2(e.target.value)} className={inputClass} />
                  </Field>
                </div>
              </div>
            )}

            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Asal Sekolah/Universitas" required icon={<Building2 className="size-4" />}>
                <input type="text" value={sekolah} onChange={(e) => setSekolah(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Kota Asal" required icon={<MapPin className="size-4" />}>
                <input type="text" value={kota} onChange={(e) => setKota(e.target.value)} className={inputClass} />
              </Field>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field label="No. Telepon" required icon={<Phone className="size-4" />}>
                <input type="tel" value={telepon} onChange={(e) => setTelepon(e.target.value)} placeholder="08xxxxxxxxxx" className={inputClass} />
              </Field>
              <Field label="Email" required icon={<Mail className="size-4" />}>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
              </Field>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-secondary/40 p-4">
              <button
                type="button"
                role="checkbox"
                aria-checked={pakta}
                onClick={() => setPakta((p) => !p)}
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                  pakta ? "border-primary bg-primary" : "border-input bg-background"
                }`}
              >
                {pakta && <CheckCircle2 className="size-4 text-primary-foreground" aria-hidden="true" />}
              </button>
              <span className="text-sm leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Pakta Integritas.</span> Saya menyatakan seluruh
                data yang diisi benar, karya orisinal dan belum pernah dilombakan, serta bersedia mematuhi
                peraturan Auditphoria 6.0.
              </span>
            </label>
          </Section>

          {kategori.karyaType !== "none" && (
            <Section number="2" title="Karya">
              {(kategori.karyaType === "file" || kategori.karyaType === "file+link") && (
                <SingleFileField
                  label={kategori.karyaFileLabel ?? "Berkas Karya"}
                  hint={kategori.karyaFileHint}
                  accept={kategori.karyaFileAccept}
                  file={karyaFile}
                  onChange={(file) => {
                    if (file && file.size > MAX_FILE_SIZE) {
                      setMessage({ type: "error", text: "Ukuran berkas melebihi 10MB." })
                      return
                    }
                    setKaryaFile(file)
                  }}
                />
              )}
              {(kategori.karyaType === "link" || kategori.karyaType === "file+link") && (
                <Field label={kategori.karyaLinkLabel ?? "Link Karya"} required hint={kategori.karyaLinkHint} icon={<LinkIcon className="size-4" />}>
                  <input
                    type="url"
                    value={karyaLink}
                    onChange={(e) => setKaryaLink(e.target.value)}
                    placeholder={kategori.karyaLinkPlaceholder}
                    className={inputClass}
                  />
                </Field>
              )}
            </Section>
          )}

          <Section number={kategori.karyaType !== "none" ? "3" : "2"} title="Berkas Umum" description="Wajib di semua kategori">
            {COMMON_FILE_FIELDS.map((f) => (
              <MultiFileField
                key={f.key}
                label={f.label}
                hint={f.hint}
                accept={f.accept}
                files={commonFiles[f.key]}
                onChange={(files) => updateCommonFiles(f.key, files)}
              />
            ))}
          </Section>

          <Section number={kategori.karyaType !== "none" ? "4" : "3"} title="Pembayaran">
            <MultiFileField
              label={PAYMENT_FIELD.label}
              hint={PAYMENT_FIELD.hint}
              accept={PAYMENT_FIELD.accept}
              files={buktiBayar}
              onChange={(files) => {
                const oversized = files.find((f) => f.size > MAX_FILE_SIZE)
                if (oversized) {
                  setMessage({ type: "error", text: `Berkas "${oversized.name}" melebihi 10MB.` })
                  return
                }
                setBuktiBayar(files)
              }}
            />
          </Section>

          {message && (
            <p role="status" className={`rounded-lg px-4 py-2.5 text-sm ${message.type === "success" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
              {message.text}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-110 active:scale-[0.99] ${
              submitting ? "opacity-70 pointer-events-none" : ""
            }`}
          >
            <CheckCircle2 className="size-5" aria-hidden="true" />
            {submitting
              ? phase === "uploading"
                ? `Mengunggah berkas${progress ? ` (${progress})` : "..."}`
                : phase === "saving"
                  ? "Menyimpan data..."
                  : "Mengirim..."
              : "Kirim Pendaftaran"}
          </button>
        </form>
      </div>
    </div>
  )
}

/* ---------- Sub-komponen ---------- */

function Section({
  number,
  title,
  description,
  children,
}: {
  number: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {number}
        </span>
        <div>
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

function Field({
  label,
  required,
  hint,
  icon,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SingleFileField({
  label,
  hint,
  accept,
  file,
  onChange,
}: {
  label: string
  hint?: string
  accept?: string
  file: File | null
  onChange: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground"><FileText className="size-4" /></span>
        {label}
        <span className="text-destructive">*</span>
      </label>

      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{file.name}</span>
            <span className="block text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-input bg-background px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-secondary/40"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <Upload className="size-4" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-medium text-foreground">Pilih file</span>
            {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  )
}

function MultiFileField({
  label,
  hint,
  accept,
  files,
  onChange,
}: {
  label: string
  hint?: string
  accept?: string
  files: File[]
  onChange: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length > 0) onChange([...files, ...selected])
    e.target.value = ""
  }

  function removeAt(index: number) {
    onChange(files.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground"><Upload className="size-4" /></span>
        {label}
        <span className="text-destructive">*</span>
      </label>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{file.name}</span>
                <span className="block text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
              </span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-input bg-background px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-secondary/40"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          {files.length > 0 ? <Upload className="size-4" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
        </span>
        <span>
          <span className="block text-sm font-medium text-foreground">{files.length > 0 ? "Tambah file lagi" : "Pilih file"}</span>
          <span className="block text-xs text-muted-foreground">{hint} · bisa pilih beberapa sekaligus</span>
        </span>
      </button>

      <input ref={inputRef} type="file" accept={accept} multiple className="sr-only" onChange={handleSelect} />
    </div>
  )
}

const inputClass =
  "w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
