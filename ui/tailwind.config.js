/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    theme: {
        extend: {
            colors: {
                'dark-paper': '#1c1049',
                'main-accent': '#3636ca',
                'bottom-grey': '#121212',
                'raised-grey': '#212124',
                background: '#111418',
            },
            boxShadow: {
                soft: '2px 2px 12px #000000aa',
            },
            animation: {
                fade: 'fadeIn 200ms ease-in-out',
                'fade-short': 'fadeIn 100ms ease-in-out',
            },
            keyframes: () => ({
                fadeIn: {
                    '0%': { opacity: 0 },
                    '100%': { opacity: 100 },
                },
            }),
        },
    },
    plugins: [],
};
