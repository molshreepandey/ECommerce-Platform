export type PaginationProps = Readonly<{
  page: number;
  pageCount: number;
  hrefForPage: (page: number) => string;
  label?: string;
}>;
