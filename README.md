# Expense Tracker

A mobile-friendly React expense tracker generated from the original Claude JSX component.

## Features

- Add and delete expenses
- Filter by category
- 7-day and 30-day category donut chart
- Receipt camera/file picker
- Browser-only persistence with `localStorage`
- Automatic GitHub Pages deployment

## Privacy and current limitation

Expense entries are stored only in the browser on the current device. They do not sync between devices. Receipt photos are not uploaded or saved, and the amount must currently be entered manually. Secure AI receipt recognition requires a server-side API endpoint and is intentionally not included in this static deployment.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

1. Create a new empty GitHub repository, for example `expense-tracker`.
2. Upload all files and folders from this project to the repository root.
3. Open **Settings → Pages** in the repository.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.
5. Open the **Actions** tab and wait for **Deploy to GitHub Pages** to finish.
6. Your site will be available at `https://YOUR-USERNAME.github.io/expense-tracker/`.

Every later commit to the `main` branch automatically republishes the site.
