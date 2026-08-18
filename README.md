# Xerox Centre — AIT Pune (Full-Stack Project)

A complete website with login/signup, real file upload, and a full print-order flow
(print options -> payment -> confirmation -> order tracking).

Built with:
- HTML, CSS, JavaScript (frontend)
- Node.js (backend) - no external packages required, no npm install needed!

## How to run it

1. Make sure Node.js is installed (check with `node -v` in terminal).
2. Open a terminal in this folder.
3. Run:
   node server.js
4. Open your browser and go to: http://localhost:3000
5. Sign up, then explore: Dashboard -> Print Centre -> upload a file -> Proceed to Print
   Options -> choose sides/color/pages -> Proceed to Payment -> Pay (demo) -> get your
   Order ID -> Track Your Order any time from the header.

## Full user flow

1. Sign up / Log in - password hashed with Node's built-in crypto module.
2. Dashboard - hover the cards for the blur/dock effect, click Print Centre.
3. Print Centre - drag & drop or click to upload files (saved for real on disk).
4. Print Options - for each uploaded file: preview (images) or a file icon, choose
   single/double-sided, color/black & white, and number of pages. Price is calculated
   live per file and as a running total.
5. Payment - a demo payment form (no real transaction, nothing is sent anywhere).
6. Confirmation - shows your unique Order ID (e.g. ORD-053A4D8C) and order summary.
7. Track Your Order - accessible from the header at any time. Enter an Order ID to
   see its live status (Order Received -> Printing in Progress -> Ready for Pickup ->
   Completed, based on time elapsed - this is a simple demo simulation).

## Deploy on Render (free)

1. Create a GitHub repository and upload this project to it.
2. Sign in to [Render](https://render.com), click **New** -> **Blueprint**, and connect
   that GitHub repository.
3. Render detects `render.yaml`. Click **Apply** and select the **Free** instance.
4. When the deploy completes, open the generated `https://xerox-centre-...onrender.com`
   address.

Alternatively, create a **Web Service** manually and use:

- Runtime: `Node`
- Build command: `echo "No build step required"`
- Start command: `node server.js`
- Instance type: `Free`

### Important free-tier limitation

Render's free web services sleep after 15 minutes without traffic. More importantly,
their filesystem is temporary: uploaded documents and the JSON files that hold users
and orders can be removed whenever the service sleeps, restarts, or redeploys. This is
fine for a project demo, but not for real customer use. A production version needs an
external database and file storage.

## Pricing (per page)

| Sides         | Black & White | Color |
|---------------|---------------|-------|
| Single-sided  | Rs 2          | Rs 5  |
| Double-sided  | Rs 3          | Rs 8  |

You can change these rates in server.js - look for PRICE_TABLE.

## Files

- server.js - the backend: auth, sessions, file uploads, orders, order tracking.
- public/ - all frontend files (HTML, CSS, JS, logo).
  - login.html, signup.html - auth pages
  - index.html - dashboard + Print Centre + Print Options + Payment + Confirmation
    + Track Order (all as sections of one page, shown/hidden with JavaScript)
- data/users.json - registered users (passwords hashed, never stored in plain text)
- data/files.json - metadata about uploaded files
- data/orders.json - all placed orders
- uploads/ - the actual uploaded files, organized by user

## Notes for learning

- Order status is simulated using elapsed time since order creation - in a real
  shop, an admin panel would let staff update order status manually.
- The payment form is a demo UI only - no real card processing, no real API calls to
  any payment gateway. Wiring up real payments (e.g. Razorpay, Stripe) is a good next
  learning project once you're comfortable with this one.
- Price is recalculated on the server when an order is placed - never trust numbers
  sent from the browser for anything involving money.
