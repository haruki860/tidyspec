/** SQL のスキーマから読み取った、ER 図に要る分だけの形。 */
export interface Column {
  name: string;
  /** 書かれたままの型。`varchar(255)` など。無ければ空 */
  type: string;
  primaryKey: boolean;
  notNull: boolean;
}

export interface ForeignKey {
  columns: string[];
  /** 参照先のテーブル名 */
  table: string;
  /** 参照先の列。省略されていれば空（参照先の主キー） */
  refColumns: string[];
}

export interface Table {
  name: string;
  columns: Column[];
  foreignKeys: ForeignKey[];
}

export interface Schema {
  tables: Table[];
}

/** テーブル名の大文字小文字は区別しない（引用符なしの SQL の名前は区別されないため）。 */
export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function findTable(schema: Schema, name: string): Table | undefined {
  return schema.tables.find((table) => sameName(table.name, name));
}
