const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.transpileModule(readFileSync(path.join(__dirname, "seed.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText;

async function seed(state = {}) {
  let resolve;
  let reject;
  const finished = new Promise((done, fail) => { resolve = done; reject = fail; });
  const client = {};
  for (const model of ["user", "group", "groupMembership", "video", "course", "courseVideo", "assignment"]) {
    const records = state[model] ??= new Map();
    const key = (where) => JSON.stringify(where);
    client[model] = {
      findUnique: async ({ where }) => records.get(key(where)) ?? null,
      upsert: async ({ where, create, update }) => {
        const existing = records.get(key(where));
        const record = existing ? { ...existing, ...update } : { id: `${model}-${records.size}`, ...create };
        records.set(key(where), record);
        return record;
      }
    };
  }
  client.$disconnect = async () => resolve(state);
  vm.runInNewContext(source, {
    exports: {},
    require: (name) => {
      if (name === "bcryptjs") return { hash: async () => "test-hash" };
      if (name === "@prisma/client") return {
        PrismaClient: function () { return client; },
        Role: { ADMIN: "ADMIN", PROFESSOR: "PROFESSOR", STUDENT: "STUDENT" },
        CourseStatus: { PUBLISHED: "PUBLISHED" }
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console: { error: reject },
    process: { exit: (code) => reject(new Error(`Seed exited: ${code}`)) }
  });
  return finished;
}

test("fresh demo uses bundled videos with reachable interactions and sequential lessons", async () => {
  const state = await seed();
  const videos = [...state.video.values()];
  assert.equal(videos.length, 2);
  for (const video of videos) {
    assert.ok(existsSync(path.join(__dirname, "..", video.sourceUrl)));
    assert.equal(video.durationSeconds, 60);
    assert.ok(video.h5pConfig.interactions.length > 0);
    assert.ok(video.h5pConfig.interactions.every((interaction) => interaction.time > 0 && interaction.time < video.durationSeconds));
  }
  const lessons = [...state.courseVideo.values()];
  assert.equal(lessons[0].gatePrevious, false);
  assert.equal(lessons[1].gatePrevious, true);
  await seed(state);
  assert.equal(state.video.size, 2);
  assert.equal(state.courseVideo.size, 2);
  assert.equal(state.assignment.size, 1);
});

test("legacy flower demo is upgraded without changing lesson identifiers", async () => {
  const state = {
    video: new Map(["demo-video-intro", "demo-video-procedure"].map((id) => [
      JSON.stringify({ id }),
      { id, sourceUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", durationSeconds: 30 }
    ])),
    course: new Map([[JSON.stringify({ id: "demo-course-safety" }), {
      id: "demo-course-safety", title: "Basic safety path"
    }]])
  };
  await seed(state);
  assert.ok([...state.video.values()].every((video) => video.sourceUrl.startsWith("/demo/") && video.durationSeconds === 60));
  assert.equal([...state.course.values()][0].title, "GDPR: dalle basi alla pratica");
  assert.equal([...state.courseVideo.values()][0].videoId, "demo-video-intro");
});

test("reseeding preserves custom sources, interactions and course titles", async () => {
  const state = await seed();
  const video = [...state.video.values()][0];
  video.sourceUrl = "/uploads/custom.mp4";
  video.h5pConfig = { interactions: [] };
  const course = [...state.course.values()][0];
  course.title = "Custom course";
  await seed(state);
  const storedVideo = state.video.get(JSON.stringify({ id: video.id }));
  assert.equal(storedVideo.sourceUrl, "/uploads/custom.mp4");
  assert.equal(storedVideo.h5pConfig.interactions.length, 0);
  assert.equal([...state.course.values()][0].title, "Custom course");
});
