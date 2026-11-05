import { ReactNode } from "react";
import { SkeletonRows } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { FileQuestion, LucideIcon } from "lucide-react";

export interface Column<T> {
  header: string;
  accessor: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  onRowClick,
  emptyTitle = "Nothing to show yet",
  emptyDescription,
  emptyIcon = FileQuestion,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
}) {
  if (loading) {
    return (
      <div className="card p-4">
        <SkeletonRows rows={5} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left">
              {columns.map((col, i) => (
                <th key={i} scope="col" className="eyebrow whitespace-nowrap px-4 py-3">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter") onRowClick(row);
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={
                  onRowClick
                    ? "cursor-pointer border-b border-border last:border-0 hover:bg-navy-50/60 focus-visible:bg-navy-50"
                    : "border-b border-border last:border-0"
                }
              >
                {columns.map((col, i) => (
                  <td key={i} className={"px-4 py-3 align-middle " + (col.className ?? "")}>
                    {col.accessor(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
