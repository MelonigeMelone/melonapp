export const TOOLBAR = 68;

export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const entries = (n: number) => count(n, 'Eintrag', 'Einträge');
