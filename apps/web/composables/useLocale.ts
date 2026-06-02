/**
 * Lightweight i18n composable.
 * Provides EN/ID translations for common UI labels.
 * Locale preference is synced from user settings and persisted in localStorage.
 */

const messages = {
  en: {
    // Navigation
    'nav.home': 'Home',
    'nav.design_systems': 'Design Systems',
    'nav.prompts': 'Prompts',
    'nav.examples': 'Examples',
    'nav.settings': 'Settings',
    'nav.search': 'Search',
    'nav.admin': 'Admin',
    'nav.admin.dashboard': 'Dashboard',
    'nav.admin.providers': 'Providers',
    'nav.admin.users': 'Users',
    'nav.admin.workspaces': 'Workspaces',
    'nav.admin.usage': 'Usage & Cost',

    // Actions
    'action.save': 'Save',
    'action.cancel': 'Cancel',
    'action.delete': 'Delete',
    'action.create': 'Create',
    'action.edit': 'Edit',
    'action.rename': 'Rename',
    'action.duplicate': 'Duplicate',
    'action.fork': 'Fork',
    'action.move': 'Move',
    'action.export': 'Export',
    'action.import': 'Import',
    'action.generate': 'Generate',
    'action.submit': 'Submit',
    'action.confirm': 'Confirm',
    'action.close': 'Close',
    'action.retry': 'Retry',
    'action.restore': 'Restore',

    // Status labels
    'status.open': 'Open',
    'status.submitted': 'Submitted',
    'status.applied': 'Applied',
    'status.resolved': 'Resolved',
    'status.rejected': 'Rejected',
    'status.pending': 'Pending',
    'status.processing': 'Processing',
    'status.completed': 'Completed',
    'status.failed': 'Failed',
    'status.cancelled': 'Cancelled',
    'status.draft': 'Draft',
    'status.active': 'Active',

    // Provider kinds
    'provider.gemini': 'Gemini',
    'provider.openai_compatible': 'OpenAI Compatible',
    'provider.cliproxyapi': 'CLIProxyAPI',

    // Generation
    'gen.brief': 'Brief / Instruction',
    'gen.language': 'Language',
    'gen.accuracy_mode': 'Accuracy mode',
    'gen.design_system': 'Design System',
    'gen.image_gen': 'Enable image generation',
    'gen.type': 'Generation Type',
    'gen.type.full_deck': 'Full Deck',
    'gen.type.single_slide': 'Add Single Slide',
    'gen.type.apply_comments': 'Apply Comments',
    'gen.type.apply_tweaks': 'Apply Tweaks',

    // Misc
    'misc.loading': 'Loading…',
    'misc.no_data': 'No data available.',
    'misc.confirm_delete': 'Are you sure you want to delete this?',
  },
  id: {
    // Navigation
    'nav.home': 'Beranda',
    'nav.design_systems': 'Sistem Desain',
    'nav.prompts': 'Prompt',
    'nav.examples': 'Contoh',
    'nav.settings': 'Pengaturan',
    'nav.search': 'Cari',
    'nav.admin': 'Admin',
    'nav.admin.dashboard': 'Dasbor',
    'nav.admin.providers': 'Penyedia',
    'nav.admin.users': 'Pengguna',
    'nav.admin.workspaces': 'Ruang Kerja',
    'nav.admin.usage': 'Penggunaan & Biaya',

    // Actions
    'action.save': 'Simpan',
    'action.cancel': 'Batal',
    'action.delete': 'Hapus',
    'action.create': 'Buat',
    'action.edit': 'Ubah',
    'action.rename': 'Ganti Nama',
    'action.duplicate': 'Duplikat',
    'action.fork': 'Cabang',
    'action.move': 'Pindah',
    'action.export': 'Ekspor',
    'action.import': 'Impor',
    'action.generate': 'Buat Otomatis',
    'action.submit': 'Kirim',
    'action.confirm': 'Konfirmasi',
    'action.close': 'Tutup',
    'action.retry': 'Coba Lagi',
    'action.restore': 'Pulihkan',

    // Status labels
    'status.open': 'Terbuka',
    'status.submitted': 'Dikirim',
    'status.applied': 'Diterapkan',
    'status.resolved': 'Selesai',
    'status.rejected': 'Ditolak',
    'status.pending': 'Menunggu',
    'status.processing': 'Memproses',
    'status.completed': 'Selesai',
    'status.failed': 'Gagal',
    'status.cancelled': 'Dibatalkan',
    'status.draft': 'Draf',
    'status.active': 'Aktif',

    // Provider kinds
    'provider.gemini': 'Gemini',
    'provider.openai_compatible': 'Kompatibel OpenAI',
    'provider.cliproxyapi': 'CLIProxyAPI',

    // Generation
    'gen.brief': 'Instruksi / Arahan',
    'gen.language': 'Bahasa',
    'gen.accuracy_mode': 'Mode akurasi',
    'gen.design_system': 'Sistem Desain',
    'gen.image_gen': 'Aktifkan pembuatan gambar',
    'gen.type': 'Jenis Pembuatan',
    'gen.type.full_deck': 'Dek Penuh',
    'gen.type.single_slide': 'Tambah Satu Slide',
    'gen.type.apply_comments': 'Terapkan Komentar',
    'gen.type.apply_tweaks': 'Terapkan Penyesuaian',

    // Misc
    'misc.loading': 'Memuat…',
    'misc.no_data': 'Tidak ada data.',
    'misc.confirm_delete': 'Yakin ingin menghapus ini?',
  },
} as const

type Locale = keyof typeof messages
type MessageKey = keyof typeof messages.en

const STORAGE_KEY = 'pepetex_locale'

const locale = ref<Locale>((typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null) as Locale ?? 'en')

watch(locale, (v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, v)
})

function t(key: MessageKey): string {
  return (messages[locale.value] as Record<string, string>)[key] ?? (messages.en as Record<string, string>)[key] ?? key
}

export function usePepeteXLocale() {
  return { locale, t }
}
