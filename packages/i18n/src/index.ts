export const supportedAppLocales = ['en', 'id'] as const;

export type AppLocale = (typeof supportedAppLocales)[number];

export const defaultAppLocale: AppLocale = 'en';
