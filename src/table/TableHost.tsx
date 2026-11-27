import type { TabState } from "../model/types";

export interface TableHostProps {
  tab: TabState;
}

/** A Table Tab's grid View. A placeholder until the grid lands. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function TableHost(_props: TableHostProps) {
  return <div data-testid="table-host" className="size-full bg-editor" />;
}
