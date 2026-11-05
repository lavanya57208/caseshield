import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex items-center flex-wrap gap-1 text-sm text-ink-subtle">
        {items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            <li>
              {item.to ? (
                <Link to={item.to} className="hover:text-teal hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className="font-medium text-ink" aria-current="page">
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
