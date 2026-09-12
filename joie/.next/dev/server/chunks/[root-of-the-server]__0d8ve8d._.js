module.exports = [
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/action-async-storage.external.js", () => require("next/dist/server/app-render/action-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/runtime-reacts.external.js", () => require("next/dist/server/runtime-reacts.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/node:path [external] (node:path, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:path", () => require("node:path"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[externals]/node:url [external] (node:url, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:url", () => require("node:url"));

module.exports = mod;
}),
"[project]/src/app/api/version/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {
__turbopack_context__.s([
    "GET",
    ()=>GET,
    "dynamic",
    ()=>dynamic,
    "runtime",
    ()=>runtime
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$depot$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/depot.ts [app-route] (ecmascript)");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$depot$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__
]);
[__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$depot$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
const runtime = "nodejs";
const dynamic = "force-dynamic";
async function GET() {
    const version = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$depot$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["versionJournal"])();
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        version
    }, {
        headers: {
            "Cache-Control": "no-store, max-age=0"
        }
    });
}
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
"[project]/src/generated/prisma/client.ts [app-route] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

/* !!! This is code generated by Prisma. Do not edit directly. !!! */ /* eslint-disable */ // biome-ignore-all lint: generated file
// @ts-nocheck 
/*
 * This file should be your main import to use Prisma. Through it you get access to all the models, enums, and input types.
 * If you're looking for something you can import in the client-side of your application, please refer to the `browser.ts` file instead.
 *
 * 🟢 You can import this file directly.
 */ __turbopack_context__.s([
    "PrismaClient",
    ()=>PrismaClient
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$url__$5b$external$5d$__$28$node$3a$url$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:url [external] (node:url, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$generated$2f$prisma$2f$internal$2f$class$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/generated/prisma/internal/class.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$generated$2f$prisma$2f$internal$2f$prismaNamespace$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/generated/prisma/internal/prismaNamespace.ts [app-route] (ecmascript)");
var __TURBOPACK__import$2e$meta__ = {
    get url () {
        return __turbopack_context__.F("src/generated/prisma/client.ts");
    },
    env: {
        DEV: true,
        PROD: false,
        MODE: "development",
        BASE_URL: "/",
        SSR: true
    },
    get turbopackHot () {
        return __turbopack_context__.m.hot;
    }
};
;
;
globalThis['__dirname'] = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["dirname"]((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$url__$5b$external$5d$__$28$node$3a$url$2c$__cjs$29$__["fileURLToPath"])(__TURBOPACK__import$2e$meta__.url));
;
;
;
;
const PrismaClient = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$generated$2f$prisma$2f$internal$2f$class$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getPrismaClientClass"]();
;
}),
"[project]/src/generated/prisma/internal/class.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getPrismaClientClass",
    ()=>getPrismaClientClass
]);
/* !!! This is code generated by Prisma. Do not edit directly. !!! */ /* eslint-disable */ // biome-ignore-all lint: generated file
// @ts-nocheck 
/*
 * WARNING: This is an internal file that is subject to change!
 *
 * 🛑 Under no circumstances should you import this file directly! 🛑
 *
 * Please import the `PrismaClient` class from the `client.ts` file instead.
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__ = __turbopack_context__.i("[externals]/@prisma/client/runtime/client [external] (@prisma/client/runtime/client, cjs, [project]/node_modules/@prisma/client)");
;
const config = {
    "previewFeatures": [],
    "clientVersion": "7.10.0",
    "engineVersion": "0edf323efd1d98336f3f0a68684b56f689b900d3",
    "activeProvider": "postgresql",
    "inlineSchema": "// Modèle de données du suivi de joie.\n//\n// PostgreSQL : c'est la base qui s'héberge gratuitement chez Neon, Supabase\n// ou Vercel, et la seule qui survive à un hébergement sans disque — un\n// fichier SQLite disparaîtrait au premier redéploiement.\n//\n// Une entrée = le niveau de joie d'une personne pour un jour donné, avec\n// l'état des deux déclencheurs suivis. La contrainte d'unicité (jour,\n// personne) est volontaire : le tableau de bord compare des moyennes\n// quotidiennes, deux mesures le même jour pour la même personne fausseraient\n// les deltas. Le formulaire détecte le doublon et bascule en modification.\n\ngenerator client {\n  provider = \"prisma-client\"\n  output   = \"../src/generated/prisma\"\n}\n\ndatasource db {\n  provider = \"postgresql\"\n}\n\nmodel Entree {\n  id String @id @default(cuid())\n\n  // Date du jour mesuré, au format ISO `AAAA-MM-JJ` : c'est le seul format\n  // qui se trie et se filtre correctement en base. L'affichage et les\n  // exports la rendent en JJ/MM/AAAA (voir src/lib/date.ts).\n  date String\n\n  personne    String // \"Momo\" | \"Sam\" | \"Samy\"\n  joie        Int // 1 → 10\n  biberon     Boolean @default(false)\n  planteVerte Boolean @default(false) @map(\"plante_verte\")\n  notes       String?\n\n  creeLe    DateTime @default(now()) @map(\"cree_le\")\n  modifieLe DateTime @updatedAt @map(\"modifie_le\")\n\n  @@unique([date, personne])\n  @@index([date])\n  @@index([personne])\n  @@map(\"entrees\")\n}\n",
    "runtimeDataModel": {
        "models": {},
        "enums": {},
        "types": {}
    },
    "parameterizationSchema": {
        "strings": [],
        "graph": ""
    }
};
config.runtimeDataModel = JSON.parse("{\"models\":{\"Entree\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"date\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"personne\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"joie\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"biberon\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"planteVerte\",\"kind\":\"scalar\",\"type\":\"Boolean\",\"dbName\":\"plante_verte\"},{\"name\":\"notes\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"creeLe\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"cree_le\"},{\"name\":\"modifieLe\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"modifie_le\"}],\"dbName\":\"entrees\",\"schema\":null}},\"enums\":{},\"types\":{}}");
config.parameterizationSchema = {
    strings: JSON.parse("[\"where\",\"Entree.findUnique\",\"Entree.findUniqueOrThrow\",\"orderBy\",\"cursor\",\"Entree.findFirst\",\"Entree.findFirstOrThrow\",\"Entree.findMany\",\"data\",\"Entree.createOne\",\"Entree.createMany\",\"Entree.createManyAndReturn\",\"Entree.updateOne\",\"Entree.updateMany\",\"Entree.updateManyAndReturn\",\"create\",\"update\",\"Entree.upsertOne\",\"Entree.deleteOne\",\"Entree.deleteMany\",\"having\",\"_count\",\"_avg\",\"_sum\",\"_min\",\"_max\",\"Entree.groupBy\",\"Entree.aggregate\",\"AND\",\"OR\",\"NOT\",\"id\",\"date\",\"personne\",\"joie\",\"biberon\",\"planteVerte\",\"notes\",\"creeLe\",\"modifieLe\",\"equals\",\"in\",\"notIn\",\"lt\",\"lte\",\"gt\",\"gte\",\"not\",\"contains\",\"startsWith\",\"endsWith\",\"date_personne\",\"set\",\"increment\",\"decrement\",\"multiply\",\"divide\"]"),
    graph: "PQsQDRwAACwAMB0AAAQAEB4AACwAMB8BAAAAASABAC0AISEBAC0AISICAC4AISMgAC8AISQgAC8AISUBADAAISZAADEAISdAADEAITMAADIAIAEAAAABACABAAAAAQAgDBwAACwAMB0AAAQAEB4AACwAMB8BAC0AISABAC0AISEBAC0AISICAC4AISMgAC8AISQgAC8AISUBADAAISZAADEAISdAADEAIQElAAAzACADAAAABAAgAwAABQAwBAAAAQAgAwAAAAQAIAMAAAUAMAQAAAEAIAMAAAAEACADAAAFADAEAAABACAJHwEAAAABIAEAAAABIQEAAAABIgIAAAABIyAAAAABJCAAAAABJQEAAAABJkAAAAABJ0AAAAABAQgAAAkAIAkfAQAAAAEgAQAAAAEhAQAAAAEiAgAAAAEjIAAAAAEkIAAAAAElAQAAAAEmQAAAAAEnQAAAAAEBCAAACwAwAQgAAAsAMAkfAQA5ACEgAQA5ACEhAQA5ACEiAgA6ACEjIAA7ACEkIAA7ACElAQA8ACEmQAA9ACEnQAA9ACECAAAAAQAgCAAADgAgCR8BADkAISABADkAISEBADkAISICADoAISMgADsAISQgADsAISUBADwAISZAAD0AISdAAD0AIQIAAAAEACAIAAAQACACAAAABAAgCAAAEAAgAwAAAAEAIA8AAAkAIBAAAA4AIAEAAAABACABAAAABAAgBhUAADQAIBYAADUAIBcAADgAIBgAADcAIBkAADYAICUAADMAIAwcAAAaADAdAAAXABAeAAAaADAfAQAbACEgAQAbACEhAQAbACEiAgAcACEjIAAdACEkIAAdACElAQAeACEmQAAfACEnQAAfACEDAAAABAAgAwAAFgAwFAAAFwAgAwAAAAQAIAMAAAUAMAQAAAEAIAwcAAAaADAdAAAXABAeAAAaADAfAQAbACEgAQAbACEhAQAbACEiAgAcACEjIAAdACEkIAAdACElAQAeACEmQAAfACEnQAAfACEOFQAAIQAgGAAAKwAgGQAAKwAgKAEAAAABKQEAAAAEKgEAAAAEKwEAAAABLAEAAAABLQEAAAABLgEAAAABLwEAKgAhMAEAAAABMQEAAAABMgEAAAABDRUAACEAIBYAACkAIBcAACEAIBgAACEAIBkAACEAICgCAAAAASkCAAAABCoCAAAABCsCAAAAASwCAAAAAS0CAAAAAS4CAAAAAS8CACgAIQUVAAAhACAYAAAnACAZAAAnACAoIAAAAAEvIAAmACEOFQAAJAAgGAAAJQAgGQAAJQAgKAEAAAABKQEAAAAFKgEAAAAFKwEAAAABLAEAAAABLQEAAAABLgEAAAABLwEAIwAhMAEAAAABMQEAAAABMgEAAAABCxUAACEAIBgAACIAIBkAACIAIChAAAAAASlAAAAABCpAAAAABCtAAAAAASxAAAAAAS1AAAAAAS5AAAAAAS9AACAAIQsVAAAhACAYAAAiACAZAAAiACAoQAAAAAEpQAAAAAQqQAAAAAQrQAAAAAEsQAAAAAEtQAAAAAEuQAAAAAEvQAAgACEIKAIAAAABKQIAAAAEKgIAAAAEKwIAAAABLAIAAAABLQIAAAABLgIAAAABLwIAIQAhCChAAAAAASlAAAAABCpAAAAABCtAAAAAASxAAAAAAS1AAAAAAS5AAAAAAS9AACIAIQ4VAAAkACAYAAAlACAZAAAlACAoAQAAAAEpAQAAAAUqAQAAAAUrAQAAAAEsAQAAAAEtAQAAAAEuAQAAAAEvAQAjACEwAQAAAAExAQAAAAEyAQAAAAEIKAIAAAABKQIAAAAFKgIAAAAFKwIAAAABLAIAAAABLQIAAAABLgIAAAABLwIAJAAhCygBAAAAASkBAAAABSoBAAAABSsBAAAAASwBAAAAAS0BAAAAAS4BAAAAAS8BACUAITABAAAAATEBAAAAATIBAAAAAQUVAAAhACAYAAAnACAZAAAnACAoIAAAAAEvIAAmACECKCAAAAABLyAAJwAhDRUAACEAIBYAACkAIBcAACEAIBgAACEAIBkAACEAICgCAAAAASkCAAAABCoCAAAABCsCAAAAASwCAAAAAS0CAAAAAS4CAAAAAS8CACgAIQgoCAAAAAEpCAAAAAQqCAAAAAQrCAAAAAEsCAAAAAEtCAAAAAEuCAAAAAEvCAApACEOFQAAIQAgGAAAKwAgGQAAKwAgKAEAAAABKQEAAAAEKgEAAAAEKwEAAAABLAEAAAABLQEAAAABLgEAAAABLwEAKgAhMAEAAAABMQEAAAABMgEAAAABCygBAAAAASkBAAAABCoBAAAABCsBAAAAASwBAAAAAS0BAAAAAS4BAAAAAS8BACsAITABAAAAATEBAAAAATIBAAAAAQwcAAAsADAdAAAEABAeAAAsADAfAQAtACEgAQAtACEhAQAtACEiAgAuACEjIAAvACEkIAAvACElAQAwACEmQAAxACEnQAAxACELKAEAAAABKQEAAAAEKgEAAAAEKwEAAAABLAEAAAABLQEAAAABLgEAAAABLwEAKwAhMAEAAAABMQEAAAABMgEAAAABCCgCAAAAASkCAAAABCoCAAAABCsCAAAAASwCAAAAAS0CAAAAAS4CAAAAAS8CACEAIQIoIAAAAAEvIAAnACELKAEAAAABKQEAAAAFKgEAAAAFKwEAAAABLAEAAAABLQEAAAABLgEAAAABLwEAJQAhMAEAAAABMQEAAAABMgEAAAABCChAAAAAASlAAAAABCpAAAAABCtAAAAAASxAAAAAAS1AAAAAAS5AAAAAAS9AACIAIQIgAQAAAAEhAQAAAAEAAAAAAAABNAEAAAABBTQCAAAAATUCAAAAATYCAAAAATcCAAAAATgCAAAAAQE0IAAAAAEBNAEAAAABATRAAAAAAQAAAAAFFQAGFgAHFwAIGAAJGQAKAAAAAAAFFQAGFgAHFwAIGAAJGQAKAQIBAgMBBQYBBgcBBwgBCQoBCgwCCw0DDA8BDRECDhIEERMBEhQBExUCGhgFGxkL"
};
async function decodeBase64AsWasm(wasmBase64) {
    const { Buffer } = await __turbopack_context__.A("[externals]/node:buffer [external] (node:buffer, cjs, async loader)");
    const wasmArray = Buffer.from(wasmBase64, 'base64');
    return new WebAssembly.Module(wasmArray);
}
config.compilerWasm = {
    getRuntime: async ()=>await __turbopack_context__.A("[externals]/@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs [external] (@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs, esm_import, [project]/node_modules/@prisma/client, async loader)"),
    getQueryCompilerWasmModule: async ()=>{
        const { wasm } = await __turbopack_context__.A("[externals]/@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs [external] (@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs, esm_import, [project]/node_modules/@prisma/client, async loader)");
        return await decodeBase64AsWasm(wasm);
    },
    importName: "./query_compiler_fast_bg.js"
};
function getPrismaClientClass() {
    return __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["getPrismaClient"](config);
}
}),
"[project]/src/generated/prisma/internal/prismaNamespace.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AnyNull",
    ()=>AnyNull,
    "DbNull",
    ()=>DbNull,
    "Decimal",
    ()=>Decimal,
    "EntreeScalarFieldEnum",
    ()=>EntreeScalarFieldEnum,
    "JsonNull",
    ()=>JsonNull,
    "ModelName",
    ()=>ModelName,
    "NullTypes",
    ()=>NullTypes,
    "NullsOrder",
    ()=>NullsOrder,
    "PrismaClientInitializationError",
    ()=>PrismaClientInitializationError,
    "PrismaClientKnownRequestError",
    ()=>PrismaClientKnownRequestError,
    "PrismaClientRustPanicError",
    ()=>PrismaClientRustPanicError,
    "PrismaClientUnknownRequestError",
    ()=>PrismaClientUnknownRequestError,
    "PrismaClientValidationError",
    ()=>PrismaClientValidationError,
    "QueryMode",
    ()=>QueryMode,
    "SortOrder",
    ()=>SortOrder,
    "Sql",
    ()=>Sql,
    "TransactionIsolationLevel",
    ()=>TransactionIsolationLevel,
    "defineExtension",
    ()=>defineExtension,
    "empty",
    ()=>empty,
    "getExtensionContext",
    ()=>getExtensionContext,
    "join",
    ()=>join,
    "prismaVersion",
    ()=>prismaVersion,
    "raw",
    ()=>raw,
    "sql",
    ()=>sql
]);
/* !!! This is code generated by Prisma. Do not edit directly. !!! */ /* eslint-disable */ // biome-ignore-all lint: generated file
// @ts-nocheck 
/*
 * WARNING: This is an internal file that is subject to change!
 *
 * 🛑 Under no circumstances should you import this file directly! 🛑
 *
 * All exports from this file are wrapped under a `Prisma` namespace object in the client.ts file.
 * While this enables partial backward compatibility, it is not part of the stable public API.
 *
 * If you are looking for your Models, Enums, and Input Types, please import them from the respective
 * model files in the `model` directory!
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__ = __turbopack_context__.i("[externals]/@prisma/client/runtime/client [external] (@prisma/client/runtime/client, cjs, [project]/node_modules/@prisma/client)");
;
const PrismaClientKnownRequestError = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["PrismaClientKnownRequestError"];
const PrismaClientUnknownRequestError = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["PrismaClientUnknownRequestError"];
const PrismaClientRustPanicError = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["PrismaClientRustPanicError"];
const PrismaClientInitializationError = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["PrismaClientInitializationError"];
const PrismaClientValidationError = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["PrismaClientValidationError"];
const sql = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["sqltag"];
const empty = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["empty"];
const join = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["join"];
const raw = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["raw"];
const Sql = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["Sql"];
const Decimal = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["Decimal"];
const getExtensionContext = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["Extensions"].getExtensionContext;
const prismaVersion = {
    client: "7.10.0",
    engine: "0edf323efd1d98336f3f0a68684b56f689b900d3"
};
const NullTypes = {
    DbNull: __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["NullTypes"].DbNull,
    JsonNull: __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["NullTypes"].JsonNull,
    AnyNull: __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["NullTypes"].AnyNull
};
const DbNull = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["DbNull"];
const JsonNull = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["JsonNull"];
const AnyNull = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["AnyNull"];
const ModelName = {
    Entree: 'Entree'
};
const TransactionIsolationLevel = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["makeStrictEnum"]({
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
});
const EntreeScalarFieldEnum = {
    id: 'id',
    date: 'date',
    personne: 'personne',
    joie: 'joie',
    biberon: 'biberon',
    planteVerte: 'planteVerte',
    notes: 'notes',
    creeLe: 'creeLe',
    modifieLe: 'modifieLe'
};
const SortOrder = {
    asc: 'asc',
    desc: 'desc'
};
const QueryMode = {
    default: 'default',
    insensitive: 'insensitive'
};
const NullsOrder = {
    first: 'first',
    last: 'last'
};
const defineExtension = __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client$2f$runtime$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2f$runtime$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["Extensions"].defineExtension;
}),
"[project]/src/lib/db.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {
__turbopack_context__.s([
    "prisma",
    ()=>prisma
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$prisma$2f$adapter$2d$pg$2f$dist$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@prisma/adapter-pg/dist/index.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$generated$2f$prisma$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/src/generated/prisma/client.ts [app-route] (ecmascript) <locals>");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$prisma$2f$adapter$2d$pg$2f$dist$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__
]);
[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$prisma$2f$adapter$2d$pg$2f$dist$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
;
/**
 * Client Prisma unique, sur PostgreSQL.
 *
 * Deux précautions, toutes deux dictées par l'hébergement visé — des
 * fonctions sans état devant une base gratuite :
 *
 * · le pool est petit. Chaque instance de la fonction ouvre le sien, et une
 *   base gratuite compte ses connexions en dizaines, pas en centaines. Trois
 *   par instance suffisent largement pour un journal de famille ;
 * · les connexions inactives sont rendues vite, pour la même raison.
 *
 * Côté URL, il faut l'adresse *avec pool* de Neon — celle dont l'hôte porte
 * `-pooler`. La directe tient quelques connexions et lâche ensuite.
 */ const global_ = globalThis;
function creerClient() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL manquante — voir joie/README.md.");
    return new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$generated$2f$prisma$2f$client$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["PrismaClient"]({
        adapter: new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$prisma$2f$adapter$2d$pg$2f$dist$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PrismaPg"]({
            connectionString: url,
            max: 3,
            idleTimeoutMillis: 10_000,
            connectionTimeoutMillis: 10_000
        })
    });
}
const prisma = global_.prisma ?? creerClient();
if ("TURBOPACK compile-time truthy", 1) global_.prisma = prisma;
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
"[project]/src/lib/depot.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

return __turbopack_context__.a(async (__turbopack_handle_async_dependencies__, __turbopack_async_result__) => { try {
__turbopack_context__.s([
    "enregistrerEntree",
    ()=>enregistrerEntree,
    "listerEntrees",
    ()=>listerEntrees,
    "modifierEntree",
    ()=>modifierEntree,
    "supprimerEntree",
    ()=>supprimerEntree,
    "trouverEntree",
    ()=>trouverEntree,
    "versionJournal",
    ()=>versionJournal
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/db.ts [app-route] (ecmascript)");
var __turbopack_async_dependencies__ = __turbopack_handle_async_dependencies__([
    __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__
]);
[__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__] = __turbopack_async_dependencies__.then ? (await __turbopack_async_dependencies__)() : __turbopack_async_dependencies__;
;
;
function versEntree(ligne) {
    return {
        id: ligne.id,
        date: ligne.date,
        personne: ligne.personne,
        joie: ligne.joie,
        biberon: ligne.biberon,
        planteVerte: ligne.planteVerte,
        notes: ligne.notes,
        creeLe: ligne.creeLe.toISOString(),
        modifieLe: ligne.modifieLe.toISOString()
    };
}
async function versionJournal() {
    const resume = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].entree.aggregate({
        _count: {
            _all: true
        },
        _max: {
            modifieLe: true
        }
    });
    const dernier = resume._max.modifieLe ? resume._max.modifieLe.getTime() : 0;
    return `${resume._count._all}-${dernier}`;
}
async function listerEntrees() {
    const lignes = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].entree.findMany({
        orderBy: [
            {
                date: "desc"
            },
            {
                personne: "asc"
            }
        ]
    });
    return lignes.map(versEntree);
}
async function trouverEntree(id) {
    const ligne = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].entree.findUnique({
        where: {
            id
        }
    });
    return ligne ? versEntree(ligne) : null;
}
async function enregistrerEntree(saisie) {
    const ligne = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].entree.upsert({
        where: {
            date_personne: {
                date: saisie.date,
                personne: saisie.personne
            }
        },
        create: saisie,
        update: saisie
    });
    return versEntree(ligne);
}
async function modifierEntree(id, saisie) {
    const ligne = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].entree.update({
        where: {
            id
        },
        data: saisie
    });
    return versEntree(ligne);
}
async function supprimerEntree(id) {
    await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prisma"].entree.delete({
        where: {
            id
        }
    });
}
__turbopack_async_result__();
} catch(e) { __turbopack_async_result__(e); } }, false);}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0d8ve8d._.js.map