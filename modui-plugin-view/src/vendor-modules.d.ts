// Types of the two files of the classic UI that `vendor.ts` imports (they are plain scripts, without declarations).

declare module 'modui-vendor/mustache' {
  const Mustache: {
    version: string;
    render(template: string, view: unknown, partials?: Record<string, string>): string;
    to_html(template: string, view: unknown, partials?: Record<string, string>): string;
    clearCache(): void;
  };
  export default Mustache;
}

declare module 'modui-vendor/sprintf' {
  const sprintf: (format: string, ...values: unknown[]) => string;
  export default sprintf;
}
