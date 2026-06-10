import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Donker navy sfeer + cyaan accenten
        navy: {
          900: "#0a1628",
          800: "#0e1d33",
          700: "#13263f",
          600: "#1b3350",
        },
        accent: {
          DEFAULT: "#06b6d4",
          hover: "#0891b2",
        },
      },
    },
  },
  plugins: [],
};

export default config;
