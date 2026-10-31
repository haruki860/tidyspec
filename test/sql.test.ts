import { describe, expect, it } from "vitest";
import { findTable } from "../src/core/schema.js";
import { parseSchema } from "../src/core/sql.js";
import { tokenize } from "../src/core/sqlTokens.js";

function table(sql: string[], name: string) {
  const found = findTable(parseSchema(sql), name);
  if (found === undefined) throw new Error(`table not found: ${name}`);
  return found;
}

describe("CREATE TABLE", () => {
  it("列の名前・型・主キー・NOT NULL を読む", () => {
    const users = table(
      [
        `CREATE TABLE users (
          id uuid PRIMARY KEY,
          email varchar(255) NOT NULL UNIQUE,
          created_at timestamp with time zone DEFAULT now(),
          tags text[]
        );`,
      ],
      "users",
    );
    expect(users.columns).toEqual([
      { name: "id", type: "uuid", primaryKey: true, notNull: true },
      { name: "email", type: "varchar(255)", primaryKey: false, notNull: true },
      { name: "created_at", type: "timestamp with time zone", primaryKey: false, notNull: false },
      { name: "tags", type: "text[]", primaryKey: false, notNull: false },
    ]);
  });

  it("型の括弧の中のカンマを、列の区切りと取り違えない", () => {
    const prices = table(
      [`CREATE TABLE prices (amount numeric(10, 2) NOT NULL, note text);`],
      "prices",
    );
    expect(prices.columns.map((c) => [c.name, c.type])).toEqual([
      ["amount", "numeric(10,2)"],
      ["note", "text"],
    ]);
  });

  it("列に書いた REFERENCES を外部キーにする", () => {
    const sessions = table(
      [
        `CREATE TABLE sessions (id int PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE);`,
      ],
      "sessions",
    );
    expect(sessions.foreignKeys).toEqual([
      { columns: ["user_id"], table: "users", refColumns: ["id"] },
    ]);
  });

  it("表の制約の PRIMARY KEY と FOREIGN KEY を読む（CONSTRAINT 名つきも）", () => {
    const items = table(
      [
        `CREATE TABLE cart_items (
          cart_id int, book_id int, quantity int,
          PRIMARY KEY (cart_id, book_id),
          CONSTRAINT fk_cart FOREIGN KEY (cart_id) REFERENCES carts (id),
          FOREIGN KEY (book_id) REFERENCES books
        );`,
      ],
      "cart_items",
    );
    expect(items.columns.filter((c) => c.primaryKey).map((c) => c.name)).toEqual([
      "cart_id",
      "book_id",
    ]);
    expect(items.foreignKeys).toEqual([
      { columns: ["cart_id"], table: "carts", refColumns: ["id"] },
      { columns: ["book_id"], table: "books", refColumns: [] },
    ]);
  });

  it("UNIQUE・CHECK の表の制約は列にしない", () => {
    const t = table(
      [`CREATE TABLE t (a int, b int, UNIQUE (a, b), CONSTRAINT c CHECK (a > 0));`],
      "t",
    );
    expect(t.columns.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("スキーマ名・引用符・IF NOT EXISTS・大文字小文字を扱う", () => {
    const sql = [`create table if not exists "public"."Order Items" ("Id" integer primary key);`];
    expect(table(sql, "order items").columns[0]?.name).toBe("Id");
    expect(table([`CREATE TABLE IF NOT EXISTS \`users\` (id integer);`], "USERS").name).toBe(
      "users",
    );
  });

  it("SQLite の AUTOINCREMENT や [名前] の引用を読む", () => {
    const t = table(
      [`CREATE TABLE [books] (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL);`],
      "books",
    );
    expect(t.columns.map((c) => [c.name, c.type, c.primaryKey])).toEqual([
      ["id", "INTEGER", true],
      ["title", "TEXT", false],
    ]);
  });

  it("文字列・コメントの中の ; , ( を区切りと取り違えない", () => {
    const t = table(
      [
        `-- users; the main table (really)
         CREATE TABLE users (
           id int, /* a, b; c */
           note text DEFAULT 'a;b,(c)'
         );
         CREATE TABLE other (id int);`,
      ],
      "users",
    );
    expect(t.columns.map((c) => c.name)).toEqual(["id", "note"]);
  });
});

describe("マイグレーション", () => {
  it("ALTER TABLE ADD CONSTRAINT FOREIGN KEY（drizzle の形）を足す", () => {
    const schema = [
      `CREATE TABLE "posts" ("id" serial PRIMARY KEY, "author_id" integer);`,
      `ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;`,
    ];
    expect(table(schema, "posts").foreignKeys).toEqual([
      { columns: ["author_id"], table: "users", refColumns: ["id"] },
    ]);
  });

  it("ADD COLUMN で列を足し、DROP COLUMN で消す。消した列の外部キーも消える", () => {
    const schema = [
      `CREATE TABLE t (id int);`,
      `ALTER TABLE t ADD COLUMN IF NOT EXISTS owner_id int REFERENCES users(id);`,
      `ALTER TABLE t ADD COLUMN extra text;`,
      `ALTER TABLE t DROP COLUMN extra, DROP COLUMN IF EXISTS owner_id;`,
    ];
    const t = table(schema, "t");
    expect(t.columns.map((c) => c.name)).toEqual(["id"]);
    expect(t.foreignKeys).toEqual([]);
  });

  it("DROP TABLE で消え、同じ名前の CREATE TABLE で作り直せる", () => {
    const dropped = parseSchema([
      `CREATE TABLE a (id int); CREATE TABLE b (id int);`,
      `DROP TABLE IF EXISTS a;`,
    ]);
    expect(dropped.tables.map((t) => t.name)).toEqual(["b"]);
    expect(
      table([`CREATE TABLE a (x int);`, `DROP TABLE a;`, `CREATE TABLE a (y int);`], "a").columns[0]
        ?.name,
    ).toBe("y");
  });

  it("読めない文（関数、インデックス、ポリシー）は黙って飛ばす", () => {
    const schema = parseSchema([
      `CREATE EXTENSION IF NOT EXISTS pgcrypto;
       CREATE TABLE a (id int);
       CREATE INDEX idx ON a (id);
       CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
       ALTER TABLE a ENABLE ROW LEVEL SECURITY;
       CREATE POLICY p ON a USING (true);`,
    ]);
    expect(schema.tables.map((t) => t.name)).toEqual(["a"]);
  });

  it("壊れた SQL でも投げず、読めた分を返す", () => {
    for (const sql of [
      "CREATE TABLE",
      "CREATE TABLE a (",
      "ALTER TABLE",
      "(((",
      "'unterminated",
      "CREATE TABLE a (id int,",
    ]) {
      expect(() => parseSchema([sql])).not.toThrow();
    }
    expect(parseSchema(["CREATE TABLE a (id int,"]).tables[0]?.columns.map((c) => c.name)).toEqual([
      "id",
    ]);
  });
});

describe("tokenize", () => {
  it("[ は、直前が名前なら配列の型、そうでなければ引用", () => {
    expect(tokenize("text[]").map((t) => t.kind)).toEqual(["word", "symbol", "symbol"]);
    expect(tokenize("[x y]").map((t) => t.kind)).toEqual(["quoted"]);
  });
});
