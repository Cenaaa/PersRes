import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import Stripe from "stripe";

// 🔥 MUST MATCH YOUR FIREBASE SECRET NAME EXACTLY
const STRIPE_SK = defineSecret("STRIPE_SECRET_KEY");

// 🔥 FULLY FIXED PAYMENT INTENT CREATION WITH CARD EXPANSION
export const createPaymentIntent = onCall(
  { secrets: [STRIPE_SK], cors: true },
  async (request) => {
    try {
      const { amount } = request.data;

      if (!amount || typeof amount !== "number") {
        throw new HttpsError("invalid-argument", "Amount is required and must be a number.");
      }

      // Initialize Stripe
      const stripe = new Stripe(STRIPE_SK.value(), {
        apiVersion: "2023-10-16",
      });

      // 🔥 Create PaymentIntent WITH full card expansion
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        payment_method_types: ["card"],

        // MUST be disabled to allow manual expansion
        automatic_payment_methods: { enabled: false },

        // 🔥 Critical: Expand complete card info
        expand: ["payment_method", "payment_method.card"],
      });

      const pm: any = paymentIntent.payment_method;

      return {
        clientSecret: paymentIntent.client_secret,

        // 🔥 Return card data directly to your frontend
        card: pm?.card
          ? {
              brand: pm.card.brand,
              last4: pm.card.last4,
              expMonth: pm.card.exp_month,
              expYear: pm.card.exp_year,
            }
          : null,

        // Also return full payment method object if needed
        paymentMethod: pm || null,
      };
    } catch (error: any) {
      console.error("Stripe createPaymentIntent error:", error);
      throw new HttpsError("internal", error.message);
    }
  }
);
