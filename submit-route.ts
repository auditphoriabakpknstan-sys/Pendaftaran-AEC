import { NextResponse } from "next/server"
import { z } from "zod"
import { COMMON_FILE_FIELDS, getKategoriConfig } from "@/lib/kategori-config"

export const runtime = "nodejs"
export const maxDuration = 60

const MIN_SUBMIT_TIME_MS = 4000
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX = 8
const rateLimitStore = new Map<string, number[]>()

function isRateLimited(ip: string) {
  const now = Date.now()
  const timestamps = (rateLimitStore.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  timestamps.push(now)
  rateLimitStore.set(ip, timestamps)
  return timestamps.length > RATE_LIMIT_MAX
}

const bodySchema = z.object({
  referenceId: z.string().min(1),
  namaTim: z.string().optional().default(""),
  ketua: z.string().trim().min(2, "Nama ketua/peserta wajib diisi."),
  anggota1: z.string().optional().default(""),
  anggota2: z.string().optional().default(""),
  sekolah: z.string().trim().min(2, "Asal sekolah/universitas wajib diisi."),
  kota: z.string().trim().min(2, "Kota asal wajib diisi."),
  telepon: z
    .string()
    .min(8, "Nomor telepon minimal 8 karakter.")
    .regex(/^[0-9+\s-]{8,}$/, "Format nomor telepon tidak valid."),
  email: z.string().email("Format email tidak valid."),
  pakta: z.literal("true", { errorMap: () => ({ message: "Pakta integritas wajib disetujui." }) }),
  karyaLink: z.string().optional().default(""),
  fileUrls: z.record(z.array(z.string())).optional().default({}),
  website: z.string().optional().default(""),
  formLoadedAt: z.number().optional().default(0),
})

export async function POST(req: Request) {
  try {
    const scriptUrl = process.env.APPS_SCRIPT_URL
    if (!scriptUrl) throw new Error("APPS_SCRIPT_URL belum diatur di environment variables.")

    // LOMBA_KATEGORI menentukan aturan validasi & nama tab Sheet untuk project ini.
    const kategori = getKategoriConfig(process.env.LOMBA_KATEGORI)

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
    if (isRateLimited(ip)) {
      return NextResponse.json({ ok: false, message: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit." }, { status: 429 })
    }

    const body = await req.json()

    const honeypot = String(body?.website ?? "")
    if (honeypot.trim() !== "") {
      return NextResponse.json({ ok: false, message: "Pendaftaran gagal dikirim. Coba lagi." }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data belum lengkap." }, { status: 400 })
    }
    const data = parsed.data

    if (data.formLoadedAt > 0 && Date.now() - data.formLoadedAt < MIN_SUBMIT_TIME_MS) {
      return NextResponse.json({ ok: false, message: "Pengisian terlalu cepat, silakan coba lagi." }, { status: 400 })
    }

    // --- Validasi ulang aturan tim sesuai kategori (JANGAN cuma percaya client) ---
    if (kategori.teamMode === "wajib3") {
      if (!data.namaTim.trim()) return badRequest("Nama tim wajib diisi.")
      if (!data.anggota1.trim() || !data.anggota2.trim()) {
        return badRequest("Kategori ini wajib 3 orang — nama anggota 1 dan 2 wajib diisi.")
      }
    }

    // --- Validasi ulang aturan karya sesuai kategori ---
    if (kategori.karyaType === "file" || kategori.karyaType === "file+link") {
      if (!data.fileUrls.karyaFile || data.fileUrls.karyaFile.length === 0) {
        return badRequest(`${kategori.karyaFileLabel ?? "Berkas karya"} wajib diunggah.`)
      }
    }
    if (kategori.karyaType === "link" || kategori.karyaType === "file+link") {
      if (!data.karyaLink.trim()) {
        return badRequest(`${kategori.karyaLinkLabel ?? "Link karya"} wajib diisi.`)
      }
    }

    // --- Validasi berkas umum wajib ---
    for (const f of COMMON_FILE_FIELDS) {
      const urls = data.fileUrls[f.key]
      if (!urls || urls.length === 0) {
        return badRequest(`Berkas "${f.label}" wajib diunggah.`)
      }
    }
    if (!data.fileUrls.buktiBayar || data.fileUrls.buktiBayar.length === 0) {
      return badRequest("Bukti pembayaran wajib diunggah.")
    }

    const scriptRes = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetName: kategori.code,
        kategoriFullName: kategori.fullName,
        referenceId: data.referenceId,
        namaTim: data.namaTim,
        ketua: data.ketua,
        anggota1: data.anggota1,
        anggota2: data.anggota2,
        sekolah: data.sekolah,
        kota: data.kota,
        telepon: data.telepon,
        email: data.email,
        karyaLink: data.karyaLink,
        fileUrls: data.fileUrls,
      }),
      redirect: "follow",
    })

    const text = await scriptRes.text()
    let result: { ok?: boolean; message?: string }
    try {
      result = JSON.parse(text)
    } catch {
      throw new Error("Respons dari Apps Script tidak valid. Cek apakah Web App sudah di-deploy dengan benar.")
    }

    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message ?? "Pendaftaran gagal dikirim." }, { status: 502 })
    }

    return NextResponse.json({ ok: true, message: result.message ?? "Pendaftaran berhasil dikirim." })
  } catch (error) {
    console.error("[/api/submit]", error)
    const message = error instanceof Error ? error.message : "Terjadi kesalahan pada server. Coba lagi."
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, message }, { status: 400 })
}
