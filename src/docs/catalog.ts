/**
 * Built-in map from the things a project depends on (npm / PyPI / Go packages, env var
 * prefixes, container images, infrastructure file types) to where their documentation lives.
 * Discovery matches against it offline; anything unknown is resolved through the package
 * registries at add time. Teams extend it with `docs.catalog` in eminiar.config.json.
 */
export interface CatalogEntry {
  /** Stable slug; becomes the default source name. */
  id: string;
  title: string;
  /** Documentation seeds; crawled same-origin under each seed's directory. */
  urls: string[];
  /** npm package names; a trailing `*` matches a scope or prefix (`@aws-sdk/*`). */
  npm?: string[] | undefined;
  pypi?: string[] | undefined;
  /** Go module path prefixes. */
  go?: string[] | undefined;
  /** Env var prefixes as written in .env files (`SUMSUB` matches `SUMSUB_APP_TOKEN`). */
  env?: string[] | undefined;
  /** Container image names without tag (`mongo`, `bitnami/kafka`). */
  image?: string[] | undefined;
  /** Infrastructure signals detected from files: terraform, kubernetes, istio, karpenter, helm, docker, github-actions. */
  files?: string[] | undefined;
  /** API hosts called from source code; a host matches itself or any subdomain (`sumsub.com` ⊇ `api.sumsub.com`). */
  hosts?: string[] | undefined;
  crawl?: { depth?: number | undefined; maxPages?: number | undefined } | undefined;
  tags?: string[] | undefined;
  /**
   * service = a third-party product/API the project integrates (indexed by `recommended`);
   * infra = platform the project runs on; library = a framework or package (opt-in: Claude
   * usually knows these, and their reference sites are large).
   */
  tier?: Tier | undefined;
}

export type Tier = "service" | "infra" | "library";

/** `api` keys are hostnames found in outbound HTTP calls. */
export type CatalogKind = "npm" | "pypi" | "go" | "env" | "image" | "files" | "api";

const shallow = { depth: 1, maxPages: 6 };

export const CATALOG: CatalogEntry[] = [
  // --- JavaScript / TypeScript runtime and frameworks ---------------------------------
  {
    id: "typescript",
    title: "TypeScript",
    urls: ["https://www.typescriptlang.org/docs/"],
    npm: ["typescript"],
    crawl: shallow,
  },
  {
    id: "express",
    title: "Express",
    urls: ["https://expressjs.com/en/4x/api.html", "https://expressjs.com/en/guide/routing.html"],
    npm: ["express"],
    crawl: shallow,
  },
  {
    id: "fastify",
    title: "Fastify",
    urls: ["https://fastify.dev/docs/latest/"],
    npm: ["fastify"],
    crawl: shallow,
  },
  { id: "koa", title: "Koa", urls: ["https://koajs.com/"], npm: ["koa"], crawl: { depth: 0 } },
  {
    id: "nestjs",
    title: "NestJS",
    urls: ["https://docs.nestjs.com/"],
    npm: ["@nestjs/*"],
    crawl: shallow,
  },
  {
    id: "nextjs",
    title: "Next.js",
    urls: ["https://nextjs.org/docs"],
    npm: ["next"],
    crawl: shallow,
  },
  { id: "nuxt", title: "Nuxt", urls: ["https://nuxt.com/docs"], npm: ["nuxt"], crawl: shallow },
  {
    id: "react",
    title: "React",
    urls: ["https://react.dev/reference/react"],
    npm: ["react", "react-dom"],
    crawl: shallow,
  },
  {
    id: "preact",
    title: "Preact",
    urls: ["https://preactjs.com/guide/v10/getting-started"],
    npm: ["preact"],
    crawl: shallow,
  },
  {
    id: "vue",
    title: "Vue 3",
    urls: ["https://vuejs.org/guide/introduction.html", "https://vuejs.org/api/"],
    npm: ["vue"],
    crawl: shallow,
  },
  {
    id: "vue-router",
    title: "Vue Router",
    urls: ["https://router.vuejs.org/guide/"],
    npm: ["vue-router"],
    crawl: shallow,
  },
  {
    id: "pinia",
    title: "Pinia",
    urls: ["https://pinia.vuejs.org/core-concepts/"],
    npm: ["pinia"],
    crawl: shallow,
  },
  {
    id: "svelte",
    title: "Svelte",
    urls: ["https://svelte.dev/docs/svelte/overview"],
    npm: ["svelte"],
    crawl: shallow,
  },
  {
    id: "vite",
    title: "Vite",
    urls: ["https://vite.dev/guide/", "https://vite.dev/config/"],
    npm: ["vite"],
    crawl: shallow,
  },
  {
    id: "tsup",
    title: "tsup",
    urls: ["https://tsup.egoist.dev/"],
    npm: ["tsup"],
    crawl: { depth: 0 },
  },
  {
    id: "turborepo",
    title: "Turborepo",
    urls: ["https://turbo.build/repo/docs"],
    npm: ["turbo"],
    crawl: shallow,
  },
  {
    id: "esbuild",
    title: "esbuild",
    urls: ["https://esbuild.github.io/api/"],
    npm: ["esbuild"],
    crawl: { depth: 0 },
  },
  {
    id: "webpack",
    title: "webpack",
    urls: ["https://webpack.js.org/concepts/"],
    npm: ["webpack"],
    crawl: shallow,
  },
  {
    id: "tailwindcss",
    title: "Tailwind CSS",
    urls: ["https://tailwindcss.com/docs/installation"],
    npm: ["tailwindcss", "@tailwindcss/*"],
    crawl: shallow,
  },

  // --- backend libraries ----------------------------------------------------------------
  {
    id: "moleculer",
    title: "Moleculer",
    urls: ["https://moleculer.services/docs/0.14/"],
    npm: ["moleculer", "moleculer-web", "moleculer-db", "moleculer-repl", "@moleculer/*"],
    crawl: { depth: 1, maxPages: 12 },
  },
  {
    id: "nats",
    tier: "infra",
    title: "NATS",
    urls: ["https://docs.nats.io/"],
    npm: ["nats", "nats.ws", "@nats-io/*"],
    env: ["NATS"],
    image: ["nats", "nats-streaming"],
    go: ["github.com/nats-io/"],
    crawl: { depth: 1, maxPages: 12 },
  },
  {
    id: "mongoose",
    title: "Mongoose",
    urls: ["https://mongoosejs.com/docs/guide.html", "https://mongoosejs.com/docs/api/"],
    npm: ["mongoose"],
    crawl: shallow,
  },
  {
    id: "mongodb",
    tier: "infra",
    title: "MongoDB",
    urls: [
      "https://www.mongodb.com/docs/drivers/node/current/",
      "https://www.mongodb.com/docs/manual/",
    ],
    npm: ["mongodb"],
    env: ["MONGO", "MONGODB", "ATLAS"],
    image: ["mongo", "mongodb"],
    go: ["go.mongodb.org/"],
    hosts: ["mongodb.net", "cloud.mongodb.com"],
    crawl: shallow,
  },
  {
    id: "postgres",
    tier: "infra",
    title: "PostgreSQL",
    urls: ["https://www.postgresql.org/docs/current/index.html", "https://node-postgres.com/"],
    npm: ["pg", "postgres"],
    env: ["PG", "POSTGRES", "DATABASE_URL"],
    image: ["postgres", "postgresql", "bitnami/postgresql"],
    pypi: ["psycopg", "psycopg2", "asyncpg"],
    crawl: shallow,
  },
  {
    id: "mysql",
    tier: "infra",
    title: "MySQL",
    urls: ["https://dev.mysql.com/doc/refman/8.4/en/"],
    npm: ["mysql2", "mysql"],
    env: ["MYSQL"],
    image: ["mysql", "mariadb"],
    crawl: { depth: 0 },
  },
  {
    id: "redis",
    tier: "infra",
    title: "Redis",
    urls: ["https://redis.io/docs/latest/develop/", "https://redis.io/docs/latest/commands/"],
    npm: ["redis", "ioredis"],
    env: ["REDIS"],
    image: ["redis", "valkey/valkey"],
    pypi: ["redis"],
    go: ["github.com/redis/go-redis"],
    crawl: shallow,
  },
  {
    id: "prisma",
    title: "Prisma",
    urls: ["https://www.prisma.io/docs/orm"],
    npm: ["prisma", "@prisma/client"],
    crawl: shallow,
  },
  {
    id: "drizzle",
    title: "Drizzle ORM",
    urls: ["https://orm.drizzle.team/docs/overview"],
    npm: ["drizzle-orm", "drizzle-kit"],
    crawl: shallow,
  },
  {
    id: "typeorm",
    title: "TypeORM",
    urls: ["https://typeorm.io/"],
    npm: ["typeorm"],
    crawl: shallow,
  },
  {
    id: "sequelize",
    title: "Sequelize",
    urls: ["https://sequelize.org/docs/v6/"],
    npm: ["sequelize"],
    crawl: shallow,
  },
  {
    id: "bullmq",
    title: "BullMQ",
    urls: ["https://docs.bullmq.io/"],
    npm: ["bullmq", "bull"],
    crawl: shallow,
  },
  {
    id: "kafka",
    tier: "infra",
    title: "Apache Kafka",
    urls: ["https://kafka.js.org/docs/getting-started", "https://kafka.apache.org/documentation/"],
    npm: ["kafkajs"],
    env: ["KAFKA"],
    image: ["confluentinc/cp-kafka", "bitnami/kafka", "apache/kafka"],
    crawl: { depth: 0 },
  },
  {
    id: "rabbitmq",
    tier: "infra",
    title: "RabbitMQ",
    urls: ["https://www.rabbitmq.com/docs"],
    npm: ["amqplib"],
    env: ["RABBITMQ", "AMQP"],
    image: ["rabbitmq"],
    crawl: shallow,
  },
  {
    id: "elasticsearch",
    tier: "infra",
    title: "Elasticsearch",
    urls: ["https://www.elastic.co/docs/reference/elasticsearch"],
    npm: ["@elastic/elasticsearch"],
    env: ["ELASTIC", "ELASTICSEARCH"],
    image: ["elasticsearch", "opensearchproject/opensearch"],
    crawl: { depth: 0 },
  },
  {
    id: "zod",
    title: "Zod",
    urls: ["https://zod.dev/"],
    npm: ["zod"],
    crawl: { depth: 1, maxPages: 8 },
  },
  { id: "joi", title: "Joi", urls: ["https://joi.dev/api/"], npm: ["joi"], crawl: { depth: 0 } },
  {
    id: "axios",
    title: "Axios",
    urls: ["https://axios-http.com/docs/intro"],
    npm: ["axios"],
    crawl: shallow,
  },
  {
    id: "undici",
    title: "undici",
    urls: ["https://undici.nodejs.org/#/"],
    npm: ["undici"],
    crawl: { depth: 0 },
  },
  {
    id: "got",
    title: "got",
    urls: ["https://github.com/sindresorhus/got#readme"],
    npm: ["got"],
    crawl: { depth: 0 },
  },
  {
    id: "jsonwebtoken",
    title: "jsonwebtoken / jose",
    urls: [
      "https://github.com/auth0/node-jsonwebtoken#readme",
      "https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md",
    ],
    npm: ["jsonwebtoken", "jose"],
    env: ["JWT"],
    crawl: { depth: 0 },
  },
  {
    id: "passport",
    title: "Passport",
    urls: ["https://www.passportjs.org/concepts/authentication/"],
    npm: ["passport", "passport-*"],
    crawl: shallow,
  },
  {
    id: "pino",
    title: "pino",
    urls: ["https://getpino.io/#/docs/api"],
    npm: ["pino", "pino-pretty"],
    crawl: { depth: 0 },
  },
  {
    id: "winston",
    title: "winston",
    urls: ["https://github.com/winstonjs/winston#readme"],
    npm: ["winston"],
    crawl: { depth: 0 },
  },
  {
    id: "socket-io",
    title: "Socket.IO",
    urls: ["https://socket.io/docs/v4/"],
    npm: ["socket.io", "socket.io-client"],
    crawl: shallow,
  },
  {
    id: "ws",
    title: "ws",
    urls: ["https://github.com/websockets/ws/blob/master/doc/ws.md"],
    npm: ["ws"],
    crawl: { depth: 0 },
  },
  {
    id: "graphql",
    title: "GraphQL",
    urls: ["https://graphql.org/learn/", "https://www.apollographql.com/docs/apollo-server"],
    npm: ["graphql", "@apollo/*"],
    crawl: shallow,
  },
  {
    id: "better-sqlite3",
    title: "better-sqlite3",
    urls: ["https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md"],
    npm: ["better-sqlite3"],
    crawl: { depth: 0 },
  },
  {
    id: "sqlite-vec",
    title: "sqlite-vec",
    urls: ["https://alexgarcia.xyz/sqlite-vec/api-reference.html"],
    npm: ["sqlite-vec"],
    crawl: { depth: 0 },
  },
  {
    id: "transformers-js",
    title: "Transformers.js",
    urls: ["https://huggingface.co/docs/transformers.js/index"],
    npm: ["@huggingface/transformers", "@xenova/transformers"],
    crawl: shallow,
  },
  {
    id: "tree-sitter",
    title: "tree-sitter",
    urls: ["https://tree-sitter.github.io/tree-sitter/using-parsers/"],
    npm: ["web-tree-sitter", "tree-sitter"],
    crawl: shallow,
  },
  {
    id: "commander",
    title: "Commander",
    urls: ["https://github.com/tj/commander.js#readme"],
    npm: ["commander"],
    crawl: { depth: 0 },
  },
  {
    id: "yargs",
    title: "yargs",
    urls: ["https://yargs.js.org/docs/"],
    npm: ["yargs"],
    crawl: { depth: 0 },
  },
  {
    id: "dotenv",
    title: "dotenv",
    urls: ["https://github.com/motdotla/dotenv#readme"],
    npm: ["dotenv"],
    crawl: { depth: 0 },
  },
  {
    id: "nodemailer",
    title: "Nodemailer",
    urls: ["https://nodemailer.com/"],
    npm: ["nodemailer"],
    crawl: shallow,
  },

  // --- testing and tooling ------------------------------------------------------------
  {
    id: "vitest",
    title: "Vitest",
    urls: ["https://vitest.dev/guide/", "https://vitest.dev/api/"],
    npm: ["vitest"],
    crawl: shallow,
  },
  {
    id: "jest",
    title: "Jest",
    urls: ["https://jestjs.io/docs/getting-started"],
    npm: ["jest", "ts-jest", "@jest/*"],
    crawl: shallow,
  },
  {
    id: "mocha",
    title: "Mocha",
    urls: ["https://mochajs.org/"],
    npm: ["mocha"],
    crawl: { depth: 0 },
  },
  {
    id: "playwright",
    title: "Playwright",
    urls: ["https://playwright.dev/docs/intro"],
    npm: ["@playwright/test", "playwright"],
    pypi: ["playwright"],
    crawl: shallow,
  },
  {
    id: "cypress",
    title: "Cypress",
    urls: ["https://docs.cypress.io/app/get-started/why-cypress"],
    npm: ["cypress"],
    crawl: shallow,
  },
  {
    id: "eslint",
    title: "ESLint",
    urls: ["https://eslint.org/docs/latest/use/configure/"],
    npm: ["eslint"],
    crawl: shallow,
  },
  {
    id: "biome",
    title: "Biome",
    urls: ["https://biomejs.dev/guides/getting-started/", "https://biomejs.dev/linter/rules/"],
    npm: ["@biomejs/biome"],
    crawl: shallow,
  },
  {
    id: "prettier",
    title: "Prettier",
    urls: ["https://prettier.io/docs/"],
    npm: ["prettier"],
    crawl: shallow,
  },
  {
    id: "husky",
    title: "husky / lint-staged",
    urls: [
      "https://typicode.github.io/husky/",
      "https://github.com/lint-staged/lint-staged#readme",
    ],
    npm: ["husky", "lint-staged"],
    crawl: { depth: 0 },
  },
  {
    id: "k6",
    tier: "infra",
    title: "Grafana k6",
    urls: ["https://grafana.com/docs/k6/latest/"],
    npm: ["k6"],
    env: ["K6"],
    image: ["grafana/k6"],
    crawl: shallow,
  },

  // --- blockchain -----------------------------------------------------------------------
  {
    id: "hardhat",
    title: "Hardhat",
    urls: ["https://hardhat.org/docs"],
    npm: ["hardhat", "@nomicfoundation/*"],
    crawl: shallow,
  },
  {
    id: "ethers",
    title: "ethers.js",
    urls: ["https://docs.ethers.org/v6/"],
    npm: ["ethers"],
    crawl: shallow,
  },
  {
    id: "viem",
    title: "viem / wagmi",
    urls: ["https://viem.sh/docs/getting-started", "https://wagmi.sh/react/getting-started"],
    npm: ["viem", "wagmi"],
    crawl: shallow,
  },
  {
    id: "openzeppelin",
    title: "OpenZeppelin Contracts",
    urls: ["https://docs.openzeppelin.com/contracts/5.x/"],
    npm: ["@openzeppelin/*"],
    crawl: shallow,
  },

  // --- cloud and SaaS providers -----------------------------------------------------------
  {
    id: "aws",
    tier: "service",
    title: "AWS",
    urls: [
      "https://docs.aws.amazon.com/",
      "https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/",
    ],
    npm: ["@aws-sdk/*", "aws-sdk"],
    pypi: ["boto3", "botocore"],
    go: ["github.com/aws/aws-sdk-go"],
    env: ["AWS"],
    hosts: ["amazonaws.com"],
    crawl: { depth: 0 },
  },
  {
    id: "aws-cognito",
    tier: "service",
    title: "Amazon Cognito",
    urls: ["https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html"],
    npm: ["amazon-cognito-identity-js", "@aws-sdk/client-cognito-identity-provider"],
    env: ["COGNITO"],
    hosts: ["amazoncognito.com"],
    crawl: { depth: 0 },
  },
  {
    id: "google-cloud",
    tier: "service",
    title: "Google Cloud",
    urls: ["https://cloud.google.com/docs"],
    npm: ["@google-cloud/*"],
    pypi: ["google-cloud-*"],
    env: ["GOOGLE_CLOUD", "GCP", "VERTEX"],
    hosts: ["googleapis.com"],
    crawl: { depth: 0 },
  },
  {
    id: "gemini",
    tier: "service",
    title: "Gemini API",
    urls: ["https://ai.google.dev/gemini-api/docs"],
    npm: ["@google/generative-ai", "@google/genai"],
    pypi: ["google-generativeai", "google-genai"],
    env: ["GEMINI"],
    hosts: ["generativelanguage.googleapis.com", "aiplatform.googleapis.com"],
    crawl: shallow,
  },
  {
    id: "anthropic",
    tier: "service",
    title: "Claude API",
    urls: ["https://docs.anthropic.com/en/api/overview"],
    npm: ["@anthropic-ai/sdk"],
    pypi: ["anthropic"],
    env: ["ANTHROPIC", "CLAUDE"],
    hosts: ["api.anthropic.com"],
    crawl: shallow,
  },
  {
    id: "openai",
    tier: "service",
    title: "OpenAI API",
    urls: ["https://platform.openai.com/docs/api-reference"],
    npm: ["openai"],
    pypi: ["openai"],
    env: ["OPENAI"],
    hosts: ["api.openai.com"],
    crawl: { depth: 0 },
  },
  {
    id: "datadog",
    tier: "service",
    title: "Datadog",
    urls: [
      "https://docs.datadoghq.com/tracing/trace_collection/automatic_instrumentation/dd_libraries/nodejs/",
      "https://docs.datadoghq.com/api/latest/",
    ],
    npm: ["dd-trace", "@datadog/*"],
    pypi: ["ddtrace", "datadog"],
    env: ["DD", "DATADOG"],
    image: ["datadog/agent"],
    hosts: ["datadoghq.com", "datadoghq.eu", "datadoghq.us"],
    crawl: { depth: 0 },
  },
  {
    id: "sentry",
    tier: "service",
    title: "Sentry",
    urls: ["https://docs.sentry.io/platforms/javascript/guides/node/"],
    npm: ["@sentry/*"],
    pypi: ["sentry-sdk"],
    env: ["SENTRY"],
    hosts: ["sentry.io", "ingest.sentry.io"],
    crawl: { depth: 0 },
  },
  {
    id: "stripe",
    tier: "service",
    title: "Stripe",
    urls: ["https://docs.stripe.com/api"],
    npm: ["stripe"],
    pypi: ["stripe"],
    env: ["STRIPE"],
    hosts: ["api.stripe.com"],
    crawl: { depth: 0 },
  },
  {
    id: "twilio-sendgrid",
    tier: "service",
    title: "SendGrid",
    urls: ["https://www.twilio.com/docs/sendgrid/api-reference"],
    npm: ["@sendgrid/*"],
    pypi: ["sendgrid"],
    env: ["SENDGRID"],
    hosts: ["api.sendgrid.com", "sendgrid.com"],
    crawl: { depth: 0 },
  },
  {
    id: "twilio",
    tier: "service",
    title: "Twilio",
    urls: ["https://www.twilio.com/docs/usage/api"],
    npm: ["twilio"],
    pypi: ["twilio"],
    env: ["TWILIO"],
    hosts: ["api.twilio.com", "twilio.com"],
    crawl: { depth: 0 },
  },
  {
    id: "slack",
    tier: "service",
    title: "Slack API",
    urls: ["https://api.slack.com/docs", "https://api.slack.com/messaging/webhooks"],
    npm: ["@slack/*"],
    pypi: ["slack_sdk", "slack-sdk"],
    env: ["SLACK"],
    hosts: ["slack.com", "hooks.slack.com"],
    crawl: { depth: 0 },
  },
  {
    id: "telegram",
    tier: "service",
    title: "Telegram Bot API",
    urls: ["https://core.telegram.org/bots/api"],
    npm: ["telegraf", "node-telegram-bot-api", "grammy"],
    env: ["TELEGRAM"],
    hosts: ["api.telegram.org"],
    crawl: { depth: 0 },
  },
  {
    id: "whatsapp",
    tier: "service",
    title: "WhatsApp Cloud API",
    urls: ["https://developers.facebook.com/docs/whatsapp/cloud-api"],
    env: ["WA", "WHATSAPP", "META_WA"],
    hosts: ["graph.facebook.com"],
    crawl: { depth: 0 },
  },
  {
    id: "github",
    tier: "service",
    title: "GitHub REST API & Actions",
    urls: ["https://docs.github.com/en/rest", "https://docs.github.com/en/actions"],
    npm: ["@octokit/*", "octokit"],
    env: ["GITHUB", "GH"],
    files: ["github-actions"],
    hosts: ["api.github.com"],
    crawl: { depth: 0 },
  },
  {
    id: "cloudflare",
    tier: "service",
    title: "Cloudflare",
    urls: ["https://developers.cloudflare.com/"],
    npm: ["wrangler", "cloudflare"],
    env: ["CLOUDFLARE", "CF"],
    hosts: ["api.cloudflare.com"],
    crawl: { depth: 0 },
  },
  {
    id: "infisical",
    tier: "service",
    title: "Infisical",
    urls: [
      "https://infisical.com/docs/documentation/getting-started/introduction",
      "https://infisical.com/docs/sdks/languages/node",
    ],
    npm: ["@infisical/sdk", "infisical-node"],
    env: ["INFISICAL"],
    hosts: ["app.infisical.com", "infisical.com"],
    crawl: shallow,
  },
  {
    id: "vault",
    tier: "service",
    title: "HashiCorp Vault",
    urls: ["https://developer.hashicorp.com/vault/docs"],
    npm: ["node-vault"],
    env: ["VAULT"],
    image: ["hashicorp/vault", "vault"],
    crawl: { depth: 0 },
  },
  {
    id: "sumsub",
    tier: "service",
    title: "Sumsub",
    urls: [
      "https://docs.sumsub.com/reference/about-sumsub-api",
      "https://docs.sumsub.com/docs/get-started-with-api",
    ],
    env: ["SUMSUB"],
    hosts: ["sumsub.com", "api.sumsub.com", "test-api.sumsub.com"],
    crawl: shallow,
  },
  {
    id: "firebase",
    tier: "service",
    title: "Firebase",
    urls: ["https://firebase.google.com/docs"],
    npm: ["firebase", "firebase-admin"],
    env: ["FIREBASE"],
    hosts: ["firebaseio.com", "firebase.googleapis.com", "fcm.googleapis.com"],
    crawl: { depth: 0 },
  },
  {
    id: "supabase",
    tier: "service",
    title: "Supabase",
    urls: ["https://supabase.com/docs"],
    npm: ["@supabase/*"],
    env: ["SUPABASE"],
    hosts: ["supabase.co"],
    crawl: { depth: 0 },
  },
  {
    id: "auth0",
    tier: "service",
    title: "Auth0",
    urls: ["https://auth0.com/docs"],
    npm: ["auth0", "@auth0/*"],
    env: ["AUTH0"],
    hosts: ["auth0.com"],
    crawl: { depth: 0 },
  },
  {
    id: "keycloak",
    tier: "service",
    title: "Keycloak",
    urls: ["https://www.keycloak.org/documentation"],
    npm: ["keycloak-js", "keycloak-connect"],
    env: ["KEYCLOAK"],
    image: ["quay.io/keycloak/keycloak", "keycloak/keycloak"],
    crawl: { depth: 0 },
  },
  {
    id: "minio",
    tier: "service",
    title: "MinIO / S3",
    urls: ["https://min.io/docs/minio/linux/developers/javascript/API.html"],
    npm: ["minio"],
    env: ["MINIO", "S3"],
    image: ["minio/minio"],
    crawl: { depth: 0 },
  },
  {
    id: "localstack",
    tier: "service",
    title: "LocalStack",
    urls: ["https://docs.localstack.cloud/overview/"],
    image: ["localstack/localstack"],
    env: ["LOCALSTACK"],
    crawl: { depth: 0 },
  },

  // --- infrastructure --------------------------------------------------------------------
  {
    id: "docker",
    tier: "infra",
    title: "Docker",
    urls: [
      "https://docs.docker.com/reference/dockerfile/",
      "https://docs.docker.com/reference/compose-file/",
    ],
    files: ["docker"],
    hosts: ["hub.docker.com", "registry-1.docker.io"],
    crawl: { depth: 0 },
  },
  {
    id: "kubernetes",
    tier: "infra",
    title: "Kubernetes",
    urls: ["https://kubernetes.io/docs/concepts/", "https://kubernetes.io/docs/reference/kubectl/"],
    files: ["kubernetes"],
    npm: ["@kubernetes/client-node"],
    go: ["k8s.io/"],
    env: ["KUBE", "KUBERNETES"],
    crawl: { depth: 0 },
  },
  {
    id: "helm",
    tier: "infra",
    title: "Helm",
    urls: ["https://helm.sh/docs/"],
    files: ["helm"],
    crawl: { depth: 0 },
  },
  {
    id: "istio",
    tier: "infra",
    title: "Istio",
    urls: [
      "https://istio.io/latest/docs/reference/config/networking/",
      "https://istio.io/latest/docs/ops/",
    ],
    files: ["istio"],
    crawl: { depth: 0 },
  },
  {
    id: "karpenter",
    tier: "infra",
    title: "Karpenter",
    urls: ["https://karpenter.sh/docs/"],
    files: ["karpenter"],
    crawl: shallow,
  },
  {
    id: "terraform",
    tier: "infra",
    title: "Terraform",
    urls: [
      "https://developer.hashicorp.com/terraform/language",
      "https://registry.terraform.io/providers/hashicorp/aws/latest/docs",
    ],
    files: ["terraform"],
    env: ["TF"],
    crawl: { depth: 0 },
  },
  {
    id: "nginx",
    tier: "infra",
    title: "NGINX",
    urls: ["https://nginx.org/en/docs/"],
    image: ["nginx", "nginxinc/nginx-unprivileged"],
    crawl: { depth: 0 },
  },
  {
    id: "traefik",
    tier: "infra",
    title: "Traefik",
    urls: ["https://doc.traefik.io/traefik/"],
    image: ["traefik"],
    crawl: { depth: 0 },
  },
  {
    id: "prometheus-grafana",
    tier: "infra",
    title: "Prometheus & Grafana",
    urls: [
      "https://prometheus.io/docs/introduction/overview/",
      "https://grafana.com/docs/grafana/latest/",
    ],
    image: ["prom/prometheus", "grafana/grafana"],
    env: ["PROMETHEUS", "GRAFANA"],
    hosts: ["grafana.net"],
    crawl: { depth: 0 },
  },
  {
    id: "jaeger",
    tier: "infra",
    title: "Jaeger / OpenTelemetry",
    urls: [
      "https://www.jaegertracing.io/docs/latest/",
      "https://opentelemetry.io/docs/languages/js/",
    ],
    npm: ["@opentelemetry/*"],
    image: ["jaegertracing/all-in-one"],
    env: ["OTEL", "JAEGER"],
    crawl: { depth: 0 },
  },

  // --- Python ------------------------------------------------------------------------------
  {
    id: "fastapi",
    title: "FastAPI",
    urls: ["https://fastapi.tiangolo.com/"],
    pypi: ["fastapi"],
    crawl: shallow,
  },
  {
    id: "django",
    title: "Django",
    urls: ["https://docs.djangoproject.com/en/stable/"],
    pypi: ["django", "djangorestframework"],
    crawl: { depth: 0 },
  },
  {
    id: "flask",
    title: "Flask",
    urls: ["https://flask.palletsprojects.com/en/stable/"],
    pypi: ["flask"],
    crawl: shallow,
  },
  {
    id: "pydantic",
    title: "Pydantic",
    urls: ["https://docs.pydantic.dev/latest/"],
    pypi: ["pydantic", "pydantic-settings"],
    crawl: shallow,
  },
  {
    id: "sqlalchemy",
    title: "SQLAlchemy",
    urls: ["https://docs.sqlalchemy.org/en/20/"],
    pypi: ["sqlalchemy", "alembic"],
    crawl: { depth: 0 },
  },
  {
    id: "pytest",
    title: "pytest",
    urls: ["https://docs.pytest.org/en/stable/"],
    pypi: ["pytest"],
    crawl: shallow,
  },
  {
    id: "requests-httpx",
    title: "requests / httpx",
    urls: ["https://requests.readthedocs.io/en/latest/", "https://www.python-httpx.org/"],
    pypi: ["requests", "httpx"],
    crawl: { depth: 0 },
  },
  {
    id: "celery",
    title: "Celery",
    urls: ["https://docs.celeryq.dev/en/stable/"],
    pypi: ["celery"],
    crawl: { depth: 0 },
  },
  {
    id: "pandas-numpy",
    title: "pandas / NumPy",
    urls: [
      "https://pandas.pydata.org/docs/user_guide/index.html",
      "https://numpy.org/doc/stable/user/index.html",
    ],
    pypi: ["pandas", "numpy"],
    crawl: { depth: 0 },
  },
  {
    id: "langchain",
    title: "LangChain",
    urls: ["https://python.langchain.com/docs/introduction/"],
    pypi: ["langchain", "langchain-*"],
    npm: ["langchain", "@langchain/*"],
    crawl: { depth: 0 },
  },

  // --- Go -----------------------------------------------------------------------------------
  {
    id: "gin",
    title: "Gin",
    urls: ["https://gin-gonic.com/docs/"],
    go: ["github.com/gin-gonic/gin"],
    crawl: shallow,
  },
  {
    id: "echo",
    title: "Echo",
    urls: ["https://echo.labstack.com/docs"],
    go: ["github.com/labstack/echo"],
    crawl: shallow,
  },
  { id: "gorm", title: "GORM", urls: ["https://gorm.io/docs/"], go: ["gorm.io/"], crawl: shallow },
  {
    id: "cobra",
    title: "Cobra",
    urls: ["https://cobra.dev/"],
    go: ["github.com/spf13/cobra"],
    crawl: { depth: 0 },
  },
];

function matches(pattern: string, value: string): boolean {
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

function envMatches(prefix: string, name: string): boolean {
  return name === prefix || name.startsWith(`${prefix}_`);
}

/** Entries from config merged over the built-ins (same id replaces). */
export function mergedCatalog(extra: CatalogEntry[] | undefined): CatalogEntry[] {
  if (!extra?.length) return CATALOG;
  const byId = new Map(CATALOG.map((e) => [e.id, e]));
  for (const e of extra) byId.set(e.id, e);
  return [...byId.values()];
}

/** Find the catalogue entry for a dependency, env var, image or infra signal. */
export function catalogLookup(
  kind: CatalogKind,
  key: string,
  catalog: CatalogEntry[] = CATALOG,
): CatalogEntry | undefined {
  const k = key.trim();
  for (const e of catalog) {
    const list = kind === "api" ? e.hosts : e[kind];
    if (!list) continue;
    if (kind === "env") {
      if (list.some((p) => envMatches(p, k))) return e;
    } else if (kind === "api") {
      const host = k.toLowerCase();
      if (list.some((h) => host === h || host.endsWith(`.${h}`))) return e;
    } else if (kind === "image") {
      const bare = k.split(":")[0]!.replace(/^docker\.io\/(library\/)?/, "");
      if (list.some((p) => matches(p, bare))) return e;
    } else if (kind === "go") {
      if (list.some((p) => k === p || k.startsWith(p))) return e;
    } else if (list.some((p) => matches(p, k))) return e;
  }
  return undefined;
}

/** Look a provider id up: `npm:zod`, `env:SUMSUB`, `image:mongo`, `files:terraform`. */
export function catalogForProvider(
  provider: string,
  catalog: CatalogEntry[] = CATALOG,
): CatalogEntry | undefined {
  const i = provider.indexOf(":");
  if (i === -1) return catalog.find((e) => e.id === provider);
  const kind = provider.slice(0, i) as CatalogKind;
  const key = provider.slice(i + 1);
  if (!["npm", "pypi", "go", "env", "image", "files", "api"].includes(kind)) return undefined;
  return catalogLookup(kind, key, catalog);
}
