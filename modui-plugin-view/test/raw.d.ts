// Vite / vitest `?raw` imports: the file as a string.
declare module '*?raw' {
  const text: string;
  export default text;
}
