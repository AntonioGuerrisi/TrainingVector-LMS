import bcrypt from "bcryptjs";
import { PrismaClient, Role, CourseStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function upsertUser(name: string, email: string, password: string, role: Role) {
  const passwordHash = await bcrypt.hash(password, 10);

  return prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, role },
    create: { name, email, passwordHash, role }
  });
}

async function main() {
  const admin = await upsertUser("LMS Admin", "admin@lms.local", "admin123", Role.ADMIN);
  const professor = await upsertUser("Training Professor", "professor@lms.local", "professor123", Role.PROFESSOR);
  const student = await upsertUser("Alex Learner", "student@lms.local", "student123", Role.STUDENT);

  const group = await prisma.group.upsert({
    where: { name: "Safety Class 2026" },
    update: {},
    create: { name: "Safety Class 2026" }
  });

  await prisma.groupMembership.upsert({
    where: { userId_groupId: { userId: student.id, groupId: group.id } },
    update: {},
    create: { userId: student.id, groupId: group.id, roleLabel: "learner" }
  });

  const demoVideos = [
    {
      id: "demo-video-intro",
      title: "GDPR - Parte 1: i concetti base",
      description: "Che cos'e il GDPR, chi lo ha approvato, a cosa serve e quali diritti tutela. Voce italiana e sottotitoli.",
      sourceUrl: "/demo/gdpr-parte-1-it.mp4",
      durationSeconds: 60,
      createdById: admin.id,
      h5pConfig: {
        interactions: [
          { id: "gdpr-intro-15", time: 15, type: "checkpoint", title: "Le regole europee", prompt: "Hai raggiunto la presentazione del regolamento." },
          {
            id: "gdpr-intro-check",
            time: 30,
            type: "popup",
            title: "Un momento per riflettere",
            prompt: "Un dato personale puo identificare una persona anche indirettamente. Hai compreso questo concetto?"
          },
          { id: "gdpr-intro-45", time: 45, type: "checkpoint", title: "I diritti delle persone", prompt: "Hai raggiunto la presentazione dei diritti." }
        ]
      }
    },
    {
      id: "demo-video-procedure",
      title: "GDPR - Parte 2: buone pratiche quotidiane",
      description: "Minimizzazione, condivisione sicura, credenziali, segnalazione delle violazioni e conservazione. Voce italiana e sottotitoli.",
      sourceUrl: "/demo/gdpr-parte-2-it.mp4",
      durationSeconds: 60,
      createdById: admin.id,
      h5pConfig: {
        interactions: [
          { id: "gdpr-practice-15", time: 15, type: "checkpoint", title: "Solo i dati necessari", prompt: "Hai raggiunto il principio di minimizzazione." },
          {
            id: "gdpr-practice-check",
            time: 30,
            type: "popup",
            title: "Prima di inviare",
            prompt: "Controlla destinatari, allegati e autorizzazioni prima di condividere dati personali. Sei pronto a proseguire?"
          },
          { id: "gdpr-practice-45", time: 45, type: "checkpoint", title: "Segnalare gli incidenti", prompt: "Hai raggiunto la gestione delle violazioni." }
        ]
      }
    }
  ];

  for (const video of demoVideos) {
    const existing = await prisma.video.findUnique({ where: { id: video.id } });
    const replaceLegacyDemo = existing?.sourceUrl === "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
    await prisma.video.upsert({
      where: { id: video.id },
      update: replaceLegacyDemo ? video : {},
      create: video
    });
  }

  const [videoOne, videoTwo] = demoVideos;
  const existingCourse = await prisma.course.findUnique({ where: { id: "demo-course-safety" } });
  const course = await prisma.course.upsert({
    where: { id: "demo-course-safety" },
    update: existingCourse?.title === "Basic safety path" ? {
      title: "GDPR: dalle basi alla pratica",
      description: "Due video in italiano da un minuto, con checkpoint e sblocco sequenziale."
    } : {},
    create: {
      id: "demo-course-safety",
      title: "GDPR: dalle basi alla pratica",
      description: "Due video in italiano da un minuto, con checkpoint e sblocco sequenziale.",
      status: CourseStatus.PUBLISHED,
      createdById: professor.id
    }
  });

  await prisma.courseVideo.upsert({
    where: { courseId_videoId: { courseId: course.id, videoId: videoOne.id } },
    update: { position: 1, gatePrevious: false },
    create: { courseId: course.id, videoId: videoOne.id, position: 1, gatePrevious: false }
  });

  await prisma.courseVideo.upsert({
    where: { courseId_videoId: { courseId: course.id, videoId: videoTwo.id } },
    update: { position: 2, gatePrevious: true },
    create: { courseId: course.id, videoId: videoTwo.id, position: 2, gatePrevious: true }
  });

  await prisma.assignment.upsert({
    where: { id: "demo-assignment-group" },
    update: {},
    create: {
      id: "demo-assignment-group",
      courseId: course.id,
      groupId: group.id,
      assignedById: professor.id,
      notes: "Demo assignment for the class group."
    }
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
