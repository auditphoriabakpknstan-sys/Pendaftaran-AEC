"use client"

import { useRef, useState } from "react"
import {
  COMMON_FILE_FIELDS,
  PAYMENT_FIELD,
  getKategoriConfig,
} from "@/lib/kategori-config"

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

  // --- Berkas umum + bukti bayar (semua bisa lebih dari 1 file) ---
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
      setMessage({ type: "success", text: `Pendaftaran berhasil! No. Referensi: ${newReferenceId}` })
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
      <main style={pageStyle}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Pendaftaran Terkirim!</h1>
          <p style={{ color: "#6b7280", marginBottom: 4 }}>{kategori.fullName}</p>
          <p style={{ fontFamily: "monospace", fontSize: 14, marginBottom: 24 }}>No. Referensi: {referenceId}</p>
          <p style={{ fontSize: 13, color: "#6b7280" }}>Simpan nomor referensi ini untuk keperluan konfirmasi.</p>
        </div>
      </main>
    )
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Formulir Pendaftaran</h1>
      <p style={{ color: "#6b7280", marginBottom: 24, fontSize: 14 }}>{kategori.fullName}</p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* honeypot anti-bot, disembunyikan dari manusia */}
        <div style={{ position: "absolute", left: -9999, width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
          <label htmlFor="website">Jangan isi field ini</label>
          <input id="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
        </div>

        <Section title="Data Peserta">
          {kategori.teamMode === "wajib3" && (
            <Field label="Nama Tim" required>
              <input type="text" value={namaTim} onChange={(e) => setNamaTim(e.target.value)} style={inputStyle} />
            </Field>
          )}
          {kategori.teamMode === "optional" && (
            <Field label="Nama Tim" hint="Opsional — kosongkan kalau daftar sendiri">
              <input type="text" value={namaTim} onChange={(e) => setNamaTim(e.target.value)} style={inputStyle} />
            </Field>
          )}

          <Field label={kategori.teamMode === "individu" ? "Nama Lengkap Peserta" : "Nama Ketua Tim"} required>
            <input type="text" value={ketua} onChange={(e) => setKetua(e.target.value)} style={inputStyle} />
          </Field>

          {kategori.teamMode !== "individu" && (
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
              <Field label="Nama Anggota 1" required={kategori.teamMode === "wajib3"} hint={kategori.teamMode === "optional" ? "Opsional" : undefined}>
                <input type="text" value={anggota1} onChange={(e) => setAnggota1(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Nama Anggota 2" required={kategori.teamMode === "wajib3"} hint={kategori.teamMode === "optional" ? "Opsional" : undefined}>
                <input type="text" value={anggota2} onChange={(e) => setAnggota2(e.target.value)} style={inputStyle} />
              </Field>
            </div>
          )}

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
            <Field label="Asal Sekolah/Universitas" required>
              <input type="text" value={sekolah} onChange={(e) => setSekolah(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Kota Asal" required>
              <input type="text" value={kota} onChange={(e) => setKota(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
            <Field label="No. Telepon" required>
              <input type="tel" value={telepon} onChange={(e) => setTelepon(e.target.value)} placeholder="08xxxxxxxxxx" style={inputStyle} />
            </Field>
            <Field label="Email" required>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "#374151" }}>
            <input type="checkbox" checked={pakta} onChange={(e) => setPakta(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <strong>Pakta Integritas.</strong> Saya menyatakan seluruh data yang diisi benar, karya orisinal dan
              belum pernah dilombakan, serta bersedia mematuhi peraturan Auditphoria 6.0.
            </span>
          </label>
        </Section>

        {kategori.karyaType !== "none" && (
          <Section title="Karya">
            {(kategori.karyaType === "file" || kategori.karyaType === "file+link") && (
              <Field label={kategori.karyaFileLabel ?? "Berkas Karya"} required hint={kategori.karyaFileHint}>
                <input
                  type="file"
                  accept={kategori.karyaFileAccept}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null
                    if (file && file.size > MAX_FILE_SIZE) {
                      setMessage({ type: "error", text: "Ukuran berkas melebihi 10MB." })
                      e.target.value = ""
                      return
                    }
                    setKaryaFile(file)
                  }}
                  style={inputStyle}
                />
              </Field>
            )}
            {(kategori.karyaType === "link" || kategori.karyaType === "file+link") && (
              <Field label={kategori.karyaLinkLabel ?? "Link Karya"} required hint={kategori.karyaLinkHint}>
                <input
                  type="url"
                  value={karyaLink}
                  onChange={(e) => setKaryaLink(e.target.value)}
                  placeholder={kategori.karyaLinkPlaceholder}
                  style={inputStyle}
                />
              </Field>
            )}
          </Section>
        )}

        <Section title="Berkas Umum (wajib semua kategori)">
          {COMMON_FILE_FIELDS.map((f) => (
            <MultiFileInput
              key={f.key}
              label={f.label}
              hint={f.hint}
              accept={f.accept}
              files={commonFiles[f.key]}
              onChange={(files) => updateCommonFiles(f.key, files)}
            />
          ))}
        </Section>

        <Section title="Pembayaran">
          <MultiFileInput
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
          <p
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 14,
              background: message.type === "success" ? "#dcfce7" : "#fee2e2",
              color: message.type === "success" ? "#166534" : "#991b1b",
            }}
          >
            {message.text}
          </p>
        )}

        <button type="submit" disabled={submitting} style={buttonStyle(submitting)}>
          {submitting
            ? phase === "uploading"
              ? `Mengunggah berkas${progress ? ` (${progress})` : "..."}`
              : phase === "saving"
                ? "Menyimpan data..."
                : "Mengirim..."
            : "Kirim Pendaftaran"}
        </button>
      </form>
    </main>
  )
}

/* ---------- Sub-komponen ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <legend style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", color: "#6366f1", padding: "0 6px" }}>{title}</legend>
      {children}
    </fieldset>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 12, color: "#6b7280" }}>{hint}</span>}
    </label>
  )
}

function MultiFileInput({
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
  return (
    <Field label={label} required hint={hint}>
      <input
        type="file"
        accept={accept}
        multiple
        onChange={(e) => onChange(Array.from(e.target.files ?? []))}
        style={inputStyle}
      />
      {files.length > 0 && (
        <span style={{ fontSize: 12, color: "#166534" }}>
          {files.length} berkas dipilih: {files.map((f) => f.name).join(", ")}
        </span>
      )}
    </Field>
  )
}

/* ---------- Style ---------- */

const pageStyle: React.CSSProperties = { maxWidth: 640, margin: "0 auto", padding: "48px 20px" }

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
  width: "100%",
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "14px 20px",
    borderRadius: 8,
    border: "none",
    background: disabled ? "#a5b4fc" : "#4f46e5",
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    cursor: disabled ? "not-allowed" : "pointer",
  }
}
