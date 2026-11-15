export type BreadcrumbItem = Readonly<{ label: string; href?: string }>;

export type BreadcrumbProps = Readonly<{ items: readonly BreadcrumbItem[] }>;
