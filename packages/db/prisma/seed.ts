import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.FIRST_ADMIN_EMAIL;
  const passwordHash = process.env.FIRST_ADMIN_PASSWORD_HASH ?? 'replace-with-real-password-hash';
  const name = process.env.FIRST_ADMIN_NAME ?? 'PepeteX Admin';

  if (!email) {
    console.log('FIRST_ADMIN_EMAIL is not set; skipping initial global admin seed.');
    return;
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: { globalRole: 'GLOBAL_ADMIN' },
    create: {
      email,
      passwordHash,
      globalRole: 'GLOBAL_ADMIN',
      profile: {
        create: { name }
      }
    },
    include: {
      profile: true,
      memberships: {
        include: {
          workspace: true
        }
      }
    }
  });

  const profile =
    user.profile ??
    (await prisma.userProfile.create({
      data: {
        userId: user.id,
        name
      }
    }));

  let personalWorkspace = user.memberships.find(
    (membership) => membership.workspace.type === 'PERSONAL'
  )?.workspace;

  if (!personalWorkspace) {
    const workspace = await prisma.workspace.create({
      data: {
        name: `${profile.name}'s Workspace`,
        type: 'PERSONAL'
      }
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER'
      }
    });

    personalWorkspace = workspace;
  }

  if (profile.defaultWorkspaceId !== personalWorkspace.id) {
    await prisma.userProfile.update({
      where: { userId: user.id },
      data: {
        defaultWorkspaceId: personalWorkspace.id
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Seed demo PromptExamples
  // ---------------------------------------------------------------------------

  const demoExamples = [
    {
      title: 'Pitch Deck for a Tech Startup',
      category: 'Pitch Deck',
      promptEn:
        'Create a compelling pitch deck for a B2B SaaS startup that helps small businesses automate their invoicing. Include problem, solution, market size, traction, team, and funding ask slides.',
      promptId:
        'Buat pitch deck yang menarik untuk startup SaaS B2B yang membantu usaha kecil mengotomatiskan penagihan. Sertakan slide masalah, solusi, ukuran pasar, traksi, tim, dan permintaan pendanaan.',
      sortOrder: 0
    },
    {
      title: 'Sales Deck for Enterprise Software',
      category: 'Sales Deck',
      promptEn:
        'Build a professional sales deck for enterprise software that streamlines HR workflows. Highlight key pain points, solution overview, ROI metrics, customer testimonials, and a clear call to action.',
      promptId:
        'Buat sales deck profesional untuk software perusahaan yang menyederhanakan alur kerja HR. Soroti poin masalah utama, ikhtisar solusi, metrik ROI, testimoni pelanggan, dan ajakan tindakan yang jelas.',
      sortOrder: 1
    },
    {
      title: 'Quarterly Business Report',
      category: 'Report',
      promptEn:
        'Generate a quarterly business performance report deck for Q3. Include revenue summary, key metrics, department highlights, challenges faced, and outlook for Q4.',
      promptId:
        'Buat deck laporan kinerja bisnis kuartalan untuk Q3. Sertakan ringkasan pendapatan, metrik utama, sorotan departemen, tantangan yang dihadapi, dan prospek untuk Q4.',
      sortOrder: 2
    },
    {
      title: 'Product Launch Presentation',
      category: 'Product Launch',
      promptEn:
        'Design a product launch presentation for a new mobile productivity app. Cover the product vision, feature highlights, target audience, go-to-market strategy, and launch timeline.',
      promptId:
        'Rancang presentasi peluncuran produk untuk aplikasi produktivitas mobile baru. Cakup visi produk, sorotan fitur, target audiens, strategi go-to-market, dan timeline peluncuran.',
      sortOrder: 3
    },
    {
      title: 'Employee Training: Data Privacy',
      category: 'Training',
      promptEn:
        'Create an employee training presentation on data privacy best practices. Include GDPR overview, common data risks, company policies, do\'s and don\'ts, and a knowledge check quiz slide.',
      promptId:
        'Buat presentasi pelatihan karyawan tentang praktik terbaik privasi data. Sertakan ikhtisar GDPR, risiko data umum, kebijakan perusahaan, hal yang boleh dan tidak boleh dilakukan, dan slide kuis pemeriksaan pengetahuan.',
      sortOrder: 4
    },
    {
      title: 'Marketing Strategy Overview',
      category: 'Strategy',
      promptEn:
        'Build a marketing strategy deck for a consumer goods brand entering a new market. Include market analysis, target personas, channel strategy, content plan, and KPIs for success.',
      promptId:
        'Buat deck strategi pemasaran untuk merek barang konsumen yang memasuki pasar baru. Sertakan analisis pasar, persona target, strategi saluran, rencana konten, dan KPI untuk keberhasilan.',
      sortOrder: 5
    },
    {
      title: 'Project Status Update',
      category: 'Report',
      promptEn:
        'Generate a project status update deck for an ongoing software development project. Include project overview, progress milestones, current blockers, team updates, and next steps.',
      promptId:
        'Buat deck pembaruan status proyek untuk proyek pengembangan software yang sedang berjalan. Sertakan ikhtisar proyek, tonggak kemajuan, hambatan saat ini, pembaruan tim, dan langkah selanjutnya.',
      sortOrder: 6
    },
    {
      title: 'Investor Update Presentation',
      category: 'Pitch Deck',
      promptEn:
        'Create a monthly investor update presentation. Include financial highlights, key wins, product progress, team updates, key risks, and what\'s coming next month.',
      promptId:
        'Buat presentasi pembaruan investor bulanan. Sertakan sorotan keuangan, kemenangan utama, kemajuan produk, pembaruan tim, risiko utama, dan apa yang akan datang bulan depan.',
      sortOrder: 7
    }
  ];

  for (const example of demoExamples) {
    await prisma.promptExample.upsert({
      where: { id: `demo-${example.sortOrder}` },
      update: {
        title: example.title,
        category: example.category,
        promptEn: example.promptEn,
        promptId: example.promptId,
        sortOrder: example.sortOrder
      },
      create: {
        id: `demo-${example.sortOrder}`,
        title: example.title,
        category: example.category,
        promptEn: example.promptEn,
        promptId: example.promptId,
        isEnabled: true,
        sortOrder: example.sortOrder
      }
    });
  }

  console.log(`Seeded ${demoExamples.length} demo prompt examples.`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
