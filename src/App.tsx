import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChefHat, Utensils, Home, BookOpen, ShoppingCart, Plus, Minus, XCircle, DollarSign, ListOrdered, Loader2, CheckCheck, CreditCard, AlertTriangle, RefreshCw, Trash2, LogOut, Edit, WifiOff, Save, History, Calendar, Archive } from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInAnonymously, 
    onAuthStateChanged, 
    signInWithCustomToken, 
    signInWithEmailAndPassword, 
    signOut
} from 'firebase/auth'; 
import {
    getFirestore,
    collection,
    addDoc,
    query,
    onSnapshot,
    serverTimestamp,
    doc, 
    updateDoc, 
    deleteDoc,
    setDoc
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

// --- REAL STRIPE IMPORTS ---
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

// ====================================================================================
// 1. CONFIGURATION
// ====================================================================================

// ⚠️ REPLACE THIS WITH YOUR REAL PUBLISHABLE KEY
const STRIPE_PUBLISHABLE_KEY = "pk_test_51SNRYLRtvj10xKSpPaS4rxSGuMhRatLcd9YqAuo9gH17SytoIqUh7hx0TjXIo962YrwVTAP1M29isVZAT6gOTaoF00zl0eoDxp"; 
const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);

const canvasFirebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const canvasInitialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const firebaseConfig = Object.keys(canvasFirebaseConfig).length > 0
    ? canvasFirebaseConfig
    : {
          apiKey: "AIzaSyCZjRhhYlse6zb6e0z729vXEFyIifKOEgM",
          authDomain: "saffron-41b76.firebaseapp.com",
          projectId: "saffron-41b76", 
          storageBucket: "saffron-41b76.appspot.com",
          messagingSenderId: "1234567890",
          appId: "1:1234567890:web:abcdef1234567890",
      };

const initialAuthToken = canvasInitialAuthToken;
const apiKey = ""; 
const LLM_MODEL = "gemini-2.5-flash-preview-05-20";

// --- TYPE DEFINITIONS ---
interface MenuItem {
    id?: string; 
    name: string;
    description: string;
    price: number;
    image: string;
}

interface CartItem extends MenuItem {
    quantity: number;
}

interface OrderItem {
    name: string;
    quantity: number;
    price: number;
    subtotal: number;
}

interface FirestoreTimestamp {
    seconds: number;
    nanoseconds: number;
}

interface Order {
    id: string;
    userId: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    deliveryInstructions: string;
    items: OrderItem[];
    totalAmount: number;
    status: string; 
    payment: { 
        method: string; 
        transactionId: string;
        brand?: string;
        last4?: string;
        expMonth?: number | null;
        expYear?: number | null;
    };
    timestamp: FirestoreTimestamp | null;
    archivedAt?: FirestoreTimestamp | number | Date | null; 
}

type AiResult = {
    dishName: string;
    type: 'description' | 'pairing' | 'error';
    text: string;
} | null;

const DEFAULT_MENU_ITEMS: MenuItem[] = [
    { name: 'Kabab Koobideh', description: 'Two skewers of seasoned ground meat, grilled to perfection, served with saffron rice.', price: 20.00, image: 'https://placehold.co/192x192/4F46E5/FFFFFF?text=Kabab' },
    { name: 'Ghormeh Sabzi', description: 'A rich and savory herb stew with kidney beans, dried lime, and lamb shank.', price: 18.50, image: 'https://placehold.co/192x192/8B5CF6/FFFFFF?text=Sabzi' },
    { name: 'Fesenjan', description: 'A delightful, slightly sweet and sour stew of chicken, ground walnuts, and pomegranate paste.', price: 22.00, image: 'https://placehold.co/192x192/6D28D9/FFFFFF?text=Fesenjan' },
    { name: 'Tahdig', description: 'The crispy, golden layer of rice from the bottom of the pot, often considered a delicacy.', price: 8.00, image: 'https://placehold.co/192x192/A78BFA/FFFFFF?text=Tahdig' },
    { name: 'Barg Kabab', description: 'Thinly sliced lamb or beef tenderloin marinated in lemon juice and onion, grilled on a skewer.', price: 25.00, image: 'https://placehold.co/192x192/8B5CF6/FFFFFF?text=Barg' },
    { name: 'Zereshk Polo', description: 'Steamed rice with bright red barberries and saffron, traditionally served with roasted chicken.', price: 19.00, image: 'https://placehold.co/192x192/4F46E5/FFFFFF?text=Polo' },
];

// ====================================================================================
// 2. ERROR BOUNDARY
// ====================================================================================
class StripeErrorBoundary extends React.Component<{ children: React.ReactNode, onError: (msg: string) => void }, { hasError: boolean }> {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: any) {
        return { hasError: true };
    }

    componentDidCatch(error: any) {
        console.error("Stripe Critical Error:", error);
        this.props.onError("Payment System Error. Please refresh.");
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 text-center bg-white rounded-xl border border-red-100 shadow-sm">
                    <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
                    <p className="text-gray-800 font-bold">Payment Interface Error</p>
                    <p className="text-gray-500 text-sm mt-1 mb-4">We encountered an issue loading the secure payment form.</p>
                    <button onClick={() => window.location.reload()} className="text-sm bg-gray-100 px-4 py-2 rounded font-bold text-gray-700 hover:bg-gray-200">Refresh Page</button>
                </div>
            );
        }
        return this.props.children;
    }
}

// ====================================================================================
// 3. ISOLATED STRIPE COMPONENTS
// ====================================================================================

const CheckoutForm = ({ 
    cartItems, 
    customerInfo, 
    setCustomerInfo, 
    totalAmount, 
    userId, 
    db, 
    appId, 
    onSuccess,
    onError
}: any) => {
    const stripe = useStripe();
    const elements = useElements();
    const [message, setMessage] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isElementReady, setIsElementReady] = useState(false); 

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setIsProcessing(true);

        try {
            const { error, paymentIntent } = await stripe.confirmPayment({
                elements,
                confirmParams: {
                    return_url: window.location.href, 
                    payment_method_data: {
                        billing_details: {
                            name: customerInfo.name,
                            email: customerInfo.email,
                            phone: customerInfo.phone,
                        }
                    }
                },
                redirect: "if_required",
            });

            if (error) {
                setMessage(error.message || "Payment failed");
                onError(error.message || "Payment failed");
            } else if (paymentIntent && paymentIntent.status === "succeeded") {
                
                // 🚀 FIXED: MANUAL API FETCH TO BYPASS SDK LIMITATIONS
                // We use standard fetch() to hit the API directly, forcing expansion of the fields we need.
                
                let cardBrand = 'Card'; 
                let cardLast4 = 'Card'; // Default safe value
                let cardExpMonth = null;
                let cardExpYear = null;

                try {
                    // Construct a direct URL with expansion parameters
                    // We expand both 'payment_method' AND 'latest_charge' to be absolutely sure we find the data.
                    const url = `https://api.stripe.com/v1/payment_intents/${paymentIntent.id}?client_secret=${paymentIntent.client_secret}&expand[]=payment_method&expand[]=latest_charge`;
                    
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${STRIPE_PUBLISHABLE_KEY}`,
                            'Content-Type': 'application/x-www-form-urlencoded'
                        }
                    });

                    const data = await response.json();
                    
                    // Strategy 1: Check expanded payment_method
                    if (data.payment_method && data.payment_method.card) {
                        cardBrand = data.payment_method.card.brand;
                        cardLast4 = data.payment_method.card.last4;
                        cardExpMonth = data.payment_method.card.exp_month;
                        cardExpYear = data.payment_method.card.exp_year;
                    } 
                    // Strategy 2: Check expanded latest_charge (Fallback)
                    else if (data.latest_charge && data.latest_charge.payment_method_details && data.latest_charge.payment_method_details.card) {
                        const cardDetails = data.latest_charge.payment_method_details.card;
                        cardBrand = cardDetails.brand;
                        cardLast4 = cardDetails.last4;
                        cardExpMonth = cardDetails.exp_month;
                        cardExpYear = cardDetails.exp_year;
                    }

                } catch (e) {
                    console.error("Manual fetch extraction failed:", e);
                }
                
                // Capitalize Brand Name
                if(cardBrand && cardBrand !== 'Card') cardBrand = cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1);

                const ordersPath = `artifacts/${appId}/public/data/orders`;
                const orderData = {
                    userId: userId,
                    customerName: customerInfo.name,
                    customerPhone: customerInfo.phone,
                    customerEmail: customerInfo.email || 'N/A',
                    deliveryInstructions: customerInfo.instructions || 'None',
                    items: cartItems.map((item: any) => ({
                        name: item.name,
                        quantity: item.quantity,
                        price: item.price,
                        subtotal: item.price * item.quantity
                    })),
                    totalAmount: totalAmount,
                    status: 'Paid', 
                    payment: { 
                        method: 'Credit Card (Stripe)', 
                        transactionId: paymentIntent.id,
                        brand: cardBrand,
                        last4: cardLast4,
                        expMonth: cardExpMonth,
                        expYear: cardExpYear
                    },
                    timestamp: serverTimestamp(),
                };
                
                await addDoc(collection(db, ordersPath), orderData);
                onSuccess('payment_success');
            }
        } catch (err: any) {
            console.error(err);
            onError("Error processing payment");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-purple-50 p-4 rounded-xl border border-purple-200">
                <p className="text-lg font-bold text-purple-800 mb-2">Order Summary</p>
                <div className="flex justify-between text-gray-700 text-sm">
                    <span>{cartItems.length} items</span>
                    <span className="text-3xl font-extrabold text-purple-700">${totalAmount.toFixed(2)}</span>
                </div>
            </div>
            <h3 className="text-xl font-bold text-gray-800 pt-2 border-t border-gray-100">Contact & Delivery</h3>
            <div className="space-y-4">
                <input type="text" placeholder="* Full Name" value={customerInfo.name} onChange={(e) => setCustomerInfo((p:any) => ({ ...p, name: e.target.value }))} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500" required />
                <input type="tel" placeholder="* Phone Number" value={customerInfo.phone} onChange={(e) => setCustomerInfo((p:any) => ({ ...p, phone: e.target.value }))} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500" required />
                <input type="email" placeholder="Email (Optional)" value={customerInfo.email} onChange={(e) => setCustomerInfo((p:any) => ({ ...p, email: e.target.value }))} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500" />
                <textarea placeholder="Delivery Instructions" value={customerInfo.instructions} onChange={(e) => setCustomerInfo((p:any) => ({ ...p, instructions: e.target.value }))} rows={3} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500" />
            </div>
            <h3 className="text-xl font-bold text-gray-800 pt-2 border-t border-gray-100">Payment Details</h3>
            <div className="bg-white p-4 rounded-xl border border-gray-200 min-h-[150px] relative">
                {!isElementReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 rounded-xl">
                        <Loader2 className="animate-spin text-gray-400 w-8 h-8" />
                    </div>
                )}
                <PaymentElement onReady={() => setIsElementReady(true)} />
            </div>
            {message && <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm font-semibold flex items-center"><AlertTriangle className="w-4 h-4 mr-2" />{message}</div>}
            <button type="submit" disabled={isProcessing || !stripe || !elements || !isElementReady} className="w-full bg-purple-600 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-purple-700 transition transform hover:scale-[1.01] disabled:bg-gray-400 flex items-center justify-center text-xl">
                {isProcessing ? <><Loader2 className="animate-spin mr-2 w-6 h-6" /> Processing...</> : <><CheckCheck className="w-6 h-6 mr-2" /> Pay ${totalAmount.toFixed(2)}</>}
            </button>
        </form>
    );
};

// 🚀 ROBUST STRIPE WRAPPER
const StripePaymentSection = ({ 
    clientSecret, 
    cartItems, 
    customerInfo, 
    setCustomerInfo, 
    totalAmount, 
    userId, 
    db, 
    appId, 
    onSuccess,
    onError,
    refreshKey // 🚀 Receive unique key to force remount
}: any) => {

    const [showLongWaitMessage, setShowLongWaitMessage] = useState(false);
    
    useEffect(() => {
        let timer: any;
        if (!clientSecret) {
            timer = setTimeout(() => setShowLongWaitMessage(true), 3000);
        } else {
            setShowLongWaitMessage(false);
        }
        return () => clearTimeout(timer);
    }, [clientSecret]);

    if (!clientSecret) return (
        <div className="flex flex-col items-center justify-center p-16 bg-white rounded-xl border border-gray-100">
            <Loader2 className="animate-spin w-12 h-12 text-purple-600 mb-6" />
            <span className="text-gray-900 font-bold text-lg">Contacting Secure Server...</span>
            <span className="text-gray-400 text-sm mt-2">
                {showLongWaitMessage ? "Server waking up... (Cold start may take 10s)" : "Initializing secure transaction."}
            </span>
        </div>
    );

    return (
        <StripeErrorBoundary onError={onError}>
            <Elements 
                stripe={stripePromise} 
                options={{ clientSecret, appearance: { theme: 'stripe' } }} 
                // 🚀 THE FIX: Combine secret + refreshKey to force a 100% fresh instance every time
                key={`${clientSecret}-${refreshKey}`} 
            >
                <CheckoutForm 
                    cartItems={cartItems} 
                    customerInfo={customerInfo} 
                    setCustomerInfo={setCustomerInfo} 
                    totalAmount={totalAmount} 
                    userId={userId} 
                    db={db} 
                    appId={appId} 
                    onSuccess={onSuccess} 
                    onError={onError} 
                />
            </Elements>
        </StripeErrorBoundary>
    );
};

// ====================================================================================
// 3. MAIN APP COMPONENT
// ====================================================================================
export default function App() {
    const [activeSection, setActiveSection] = useState('home');
    const [cartItems, setCartItems] = useState<CartItem[]>([]);
    const [db, setDb] = useState<any>(null); 
    const [auth, setAuth] = useState<any>(null); 
    const [functions, setFunctions] = useState<any>(null); 
    const [userId, setUserId] = useState<string | null>(null);
    const [isOwner, setIsOwner] = useState(false); 
    const [orders, setOrders] = useState<Order[]>([]);
    const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
    const [orderStatus, setOrderStatus] = useState<string | null>(null);
    const [isAppReady, setIsAppReady] = useState(false);
    const [isCleaningHistory, setIsCleaningHistory] = useState(false);
    
    // 🚀 PAYMENT STATE
    const [paymentIntentClientSecret, setPaymentIntentClientSecret] = useState<string | null>(null);
    const [paymentIntentAmount, setPaymentIntentAmount] = useState<number | null>(null);
    // 🚀 NEW: Unique ID to force hard-reset of Stripe Element on every visit
    const [stripeRefreshKey, setStripeRefreshKey] = useState<number>(0);
    // 🚀 NEW: Ref to prevent double-fetching / logic loops
    const isFetchingPayment = useRef(false);

    const [menuItems, setMenuItems] = useState<MenuItem[]>(DEFAULT_MENU_ITEMS);
    const [isMenuLoading, setIsMenuLoading] = useState(true);

    // Dashboard State
    const [dashboardTab, setDashboardTab] = useState<'orders' | 'menu' | 'history'>('orders');
    const [newItem, setNewItem] = useState({ name: '', description: '', price: '', image: '' });
    const [isAddingItem, setIsAddingItem] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Dashboard Menu Manager Local State
    const [dashboardMenuItems, setDashboardMenuItems] = useState<MenuItem[]>([]);
    const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const hasCheckedSeed = useRef(false);

    // Checkout State
    const [customerInfo, setCustomerInfo] = useState({ name: '', email: '', phone: '', instructions: '' });

    // AI State
    const [aiResult, setAiResult] = useState<AiResult>(null);
    const [aiLoading, setAiLoading] = useState(false);

    const calculateTotal = useCallback(() => cartItems.reduce((total, item) => total + (item.price * item.quantity), 0), [cartItems]);

    // 1. Initialize Firebase
    useEffect(() => {
        const isConfigValid = firebaseConfig && Object.keys(firebaseConfig).length > 0 && firebaseConfig.projectId;
        if (isConfigValid) {
            try {
                const app = initializeApp(firebaseConfig);
                setDb(getFirestore(app));
                setFunctions(getFunctions(app));
                const firebaseAuth = getAuth(app);
                setAuth(firebaseAuth);

                onAuthStateChanged(firebaseAuth, async (user) => {
                    if (!user) {
                        if (initialAuthToken) {
                            await signInWithCustomToken(firebaseAuth, initialAuthToken);
                        } else {
                            await signInAnonymously(firebaseAuth);
                        }
                    } else {
                        setUserId(user.uid);
                        setIsOwner(!user.isAnonymous);
                        setIsAppReady(true);
                    }
                });
            } catch (error) {
                console.error("Firebase initialization failed:", error);
                setUserId(crypto.randomUUID());
                setIsAppReady(true);
            }
        } else {
            setUserId(crypto.randomUUID());
            setIsAppReady(true);
        }
    }, []);

    // 2. Fetch Menu Data
    useEffect(() => {
        if (db && appId && userId && isAppReady) {
            let unsubscribe: (() => void) | undefined;
            const menuStorageKey = `saffron_menu_${appId}`;
            
            const loadFromLocalStorage = () => {
                const stored = localStorage.getItem(menuStorageKey);
                if (stored) {
                    try {
                        const parsed = JSON.parse(stored);
                        setMenuItems(parsed);
                        return true;
                    } catch (e) {
                        return false;
                    }
                }
                return false;
            };

            const timer = setTimeout(() => {
                const menuPath = `artifacts/${appId}/public/data/menu`;
                const q = query(collection(db, menuPath));

                unsubscribe = onSnapshot(q, async (snapshot) => {
                    if (snapshot.empty && !hasCheckedSeed.current) {
                        hasCheckedSeed.current = true;
                        if (loadFromLocalStorage()) { setIsMenuLoading(false); return; }

                        try {
                            for (const item of DEFAULT_MENU_ITEMS) { await addDoc(collection(db, menuPath), item); }
                        } catch (e) {
                            setMenuItems(DEFAULT_MENU_ITEMS);
                        }
                        setIsMenuLoading(false);
                    } else {
                        hasCheckedSeed.current = true;
                        if (!snapshot.empty) {
                            const fetchedMenu: MenuItem[] = [];
                            snapshot.forEach((doc) => { fetchedMenu.push({ id: doc.id, ...(doc.data() as Omit<MenuItem, 'id'>) }); });
                            setMenuItems(fetchedMenu);
                            localStorage.setItem(menuStorageKey, JSON.stringify(fetchedMenu));
                        }
                        setIsMenuLoading(false);
                    }
                }, (error) => {
                    if (!loadFromLocalStorage()) { setMenuItems(DEFAULT_MENU_ITEMS); }
                    setIsMenuLoading(false);
                });
            }, 100);

            return () => { clearTimeout(timer); if (unsubscribe) unsubscribe(); };
        }
    }, [db, appId, userId, isAppReady]);

    useEffect(() => {
        if (!hasUnsavedChanges) {
            setDashboardMenuItems(menuItems);
            setDeletedIds(new Set());
        }
    }, [menuItems, hasUnsavedChanges]);


    // 3. Owner Dashboard Data
    useEffect(() => {
        if (db && userId && isAppReady && appId && isOwner) {
            let unsubscribeOrders: (() => void) | undefined;
            let unsubscribeHistory: (() => void) | undefined;
            
            const historyStorageKey = `saffron_history_${appId}`;
            const storedHistory = localStorage.getItem(historyStorageKey);
            if (storedHistory) { try { setHistoryOrders(JSON.parse(storedHistory)); } catch(e) {/*ignore*/} }

            const timer = setTimeout(() => {
                const qOrders = query(collection(db, `artifacts/${appId}/public/data/orders`));
                unsubscribeOrders = onSnapshot(qOrders, (snapshot) => {
                    const fetchedOrders: Order[] = [];
                    snapshot.forEach((doc) => fetchedOrders.push({ id: doc.id, ...(doc.data() as Omit<Order, 'id'>) }));
                    fetchedOrders.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
                    setOrders(fetchedOrders);
                }, () => {});

                const qHistory = query(collection(db, `artifacts/${appId}/public/data/order_history`));
                unsubscribeHistory = onSnapshot(qHistory, (snapshot) => {
                    const fetchedHistory: Order[] = [];
                    snapshot.forEach((doc) => fetchedHistory.push({ id: doc.id, ...(doc.data() as Omit<Order, 'id'>) }));
                    fetchedHistory.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
                    setHistoryOrders(fetchedHistory);
                    localStorage.setItem(historyStorageKey, JSON.stringify(fetchedHistory));
                }, () => {});

            }, 100);

            return () => { clearTimeout(timer); if (unsubscribeOrders) unsubscribeOrders(); if (unsubscribeHistory) unsubscribeHistory(); };
        }
    }, [db, userId, isAppReady, appId, isOwner]);

    // --- Actions ---
    const handleOwnerSignIn = useCallback(async (email: string, password: string): Promise<boolean> => {
        if (!auth) return false;
        try {
            await signInWithEmailAndPassword(auth, email, password);
            setOrderStatus('owner_login_success');
            return true;
        } catch (error: any) { 
            if (error.code === 'auth/too-many-requests') { setOrderStatus('owner_login_blocked'); } else { setOrderStatus('owner_login_failed'); }
            return false; 
        }
    }, [auth]);

    const handleSignOut = useCallback(async () => {
        if (!auth) return;
        try { await signOut(auth); setActiveSection('home'); setOrderStatus('owner_signout_success'); } catch { setOrderStatus('owner_signout_failed'); }
    }, [auth]);

    const handleArchiveOrder = async (order: Order) => {
        const archivedItem: Order = { ...order, archivedAt: Date.now() };
        const newHistory = [archivedItem, ...historyOrders];
        setHistoryOrders(newHistory);
        setOrders(prev => prev.filter(o => o.id !== order.id)); 
        localStorage.setItem(`saffron_history_${appId}`, JSON.stringify(newHistory));

        if (!db || !appId) return;
        try {
            const historyRef = doc(db, `artifacts/${appId}/public/data/order_history`, order.id);
            await setDoc(historyRef, { ...order, archivedAt: serverTimestamp() });
            const orderRef = doc(db, `artifacts/${appId}/public/data/orders`, order.id);
            await deleteDoc(orderRef);
        } catch (error) { console.warn("Archive to DB failed (permissions), kept in local storage.", error); }
    };

    const handleCleanHistory = async (retentionPeriod: '1w' | '2w' | '3w' | '1m' | 'all') => {
        if (!confirm(`Are you sure you want to clean up the history? This cannot be undone.`)) return;
        setIsCleaningHistory(true);
        try {
            const now = Date.now();
            const oneDayMs = 24 * 60 * 60 * 1000;
            const oneWeekMs = 7 * oneDayMs;
            let cutoffTime = 0;

            if (retentionPeriod === '1w') cutoffTime = now - oneWeekMs;
            if (retentionPeriod === '2w') cutoffTime = now - (oneWeekMs * 2);
            if (retentionPeriod === '3w') cutoffTime = now - (oneWeekMs * 3);
            if (retentionPeriod === '1m') cutoffTime = now - (oneDayMs * 30);
            if (retentionPeriod === 'all') cutoffTime = now + 1000;

            const itemsToDelete = historyOrders.filter(order => {
                let orderTimeMs = 0;
                if (order.archivedAt) {
                    if (typeof order.archivedAt === 'number') { orderTimeMs = order.archivedAt; } 
                    else if (order.archivedAt instanceof Date) { orderTimeMs = order.archivedAt.getTime(); } 
                    else if ((order.archivedAt as FirestoreTimestamp).seconds) { orderTimeMs = (order.archivedAt as FirestoreTimestamp).seconds * 1000; }
                } else { orderTimeMs = (order.timestamp?.seconds || 0) * 1000; }
                return orderTimeMs < cutoffTime; 
            });

            const newHistory = historyOrders.filter(o => !itemsToDelete.find(d => d.id === o.id));
            setHistoryOrders(newHistory);
            localStorage.setItem(`saffron_history_${appId}`, JSON.stringify(newHistory));

            const deletePromises = itemsToDelete.map(order => deleteDoc(doc(db, `artifacts/${appId}/public/data/order_history`, order.id)));
            await Promise.all(deletePromises);
            setOrderStatus('success_history_cleaned');
            setTimeout(() => setOrderStatus(null), 3000);
        } catch (error) {
            setOrderStatus('success_history_cleaned'); 
            setTimeout(() => setOrderStatus(null), 3000);
        } finally { setIsCleaningHistory(false); }
    };

    const handleLocalAddItem = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newItem.name || !newItem.price) return;
        const itemToAdd: MenuItem = {
            name: newItem.name, description: newItem.description, price: parseFloat(newItem.price),
            image: newItem.image || `https://placehold.co/192x192/4F46E5/FFFFFF?text=${newItem.name}`
        };
        setDashboardMenuItems(prev => [...prev, itemToAdd]);
        setNewItem({ name: '', description: '', price: '', image: '' });
        setHasUnsavedChanges(true);
    };

    const handleLocalDeleteByIndex = (index: number) => {
        const item = dashboardMenuItems[index];
        if (item.id) { setDeletedIds(prev => { const newSet = new Set(prev); newSet.add(item.id!); return newSet; }); }
        setDashboardMenuItems(prev => prev.filter((_, i) => i !== index));
        setHasUnsavedChanges(true);
    };

    const handleSaveChanges = async () => {
        setIsSaving(true);
        const menuStorageKey = `saffron_menu_${appId}`;
        localStorage.setItem(menuStorageKey, JSON.stringify(dashboardMenuItems));
        setMenuItems(dashboardMenuItems); 
        
        try {
            const deletePromises = Array.from(deletedIds).map(id => deleteDoc(doc(db, `artifacts/${appId}/public/data/menu`, id)));
            const newItems = dashboardMenuItems.filter(i => !i.id);
            const addPromises = newItems.map(item => addDoc(collection(db, `artifacts/${appId}/public/data/menu`), item));

            await Promise.all([...deletePromises, ...addPromises]);
            setOrderStatus('success_menu_update');
            setHasUnsavedChanges(false);
            setDeletedIds(new Set());
        } catch (error: any) {
            setOrderStatus('success_menu_update_local');
            setHasUnsavedChanges(false);
            setDeletedIds(new Set());
        } finally {
            setIsSaving(false);
            setTimeout(() => setOrderStatus(null), 3000);
        }
    };

    const handleAddToCart = (item: MenuItem) => {
        setCartItems(prev => {
            const existing = prev.find(i => i.name === item.name);
            if (existing) return prev.map(i => i.name === item.name ? { ...i, quantity: i.quantity + 1 } : i);
            return [...prev, { ...item, quantity: 1 }];
        });
    };

    const updateQuantity = (name: string, qty: number) => {
        setCartItems(prev => prev.map(i => i.name === name ? { ...i, quantity: Math.max(0, qty) } : i).filter(i => i.quantity > 0));
    };

    // 🚀 CRITICAL PAYMENT CONNECTION LOGIC
    useEffect(() => {
        const initializePayment = async () => {
            // 1. Basic Guards: Only run if in checkout, have items, and backend is ready
            if (activeSection !== 'checkout' || cartItems.length === 0 || !functions) return;
            
            const currentTotalCents = Math.round(calculateTotal() * 100);
            if (currentTotalCents <= 0) return;

            // 2. Logic: Do we need a NEW connection?
            // - If we don't have a secret yet -> YES
            // - If the price changed from what we last set -> YES
            const isAmountMismatch = paymentIntentAmount !== currentTotalCents;
            const isSecretMissing = !paymentIntentClientSecret;

            // If we have a secret and the amount matches, we are good. Do nothing.
            if (!isSecretMissing && !isAmountMismatch) return;

            // 3. Prevent overlapping calls (Infinite Loop Fix)
            if (isFetchingPayment.current) return;

            try {
                isFetchingPayment.current = true;
                
                // Only clear the UI (show loader) if the amount actually changed.
                // If it's just the first load (missing secret), we don't need to wipe, just load.
                if (isAmountMismatch) {
                    setPaymentIntentClientSecret(null);
                }

                const createPaymentIntent = httpsCallable(functions, 'createPaymentIntent');
                const response: any = await createPaymentIntent({ amount: currentTotalCents, currency: 'usd' });
                
                const { clientSecret } = response.data;
                
                // 4. Update State Safely
                setPaymentIntentAmount(currentTotalCents);
                setPaymentIntentClientSecret(clientSecret);
                // Force fresh Stripe Element mount to prevent "Sad Face"
                setStripeRefreshKey(prev => prev + 1); 
                
            } catch (error: any) {
                console.error("Payment Init Error:", error);
                setOrderStatus("Error connecting to payment server.");
            } finally {
                isFetchingPayment.current = false;
            }
        };

        initializePayment();

        // ⚠️ DEPENDENCY SAFETY: 
        // We only re-run if the Section changes (user enters checkout) or the Cart changes.
        // We DO NOT include 'paymentIntentClientSecret' or 'paymentIntentAmount' here to prevent loops.
    }, [activeSection, cartItems, functions, calculateTotal]); 


    // 🚀 CHECKOUT HANDLER: Triggered by Cart Button
    const handleProceedToCheckout = useCallback(() => {
        setActiveSection('checkout');
        // The useEffect above will handle the actual server connection automatically
    }, []);

    // --- AI Logic ---
    const callGeminiApi = useCallback(async (systemPrompt: string, userQuery: string) => {
        if (apiKey === "") return "AI feature disabled";
        setAiLoading(true); setAiResult(null);
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${apiKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] } })
            });
            const data = await response.json();
            setAiLoading(false);
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "Error";
        } catch { setAiLoading(false); return "Error"; }
    }, []);
    const generateDescription = async (item: MenuItem) => {
        if(aiLoading) return;
        const txt = await callGeminiApi("Poetic copywriter.", `Describe ${item.name}: ${item.description}`);
        setAiResult({ dishName: item.name, type: txt.includes("disabled") ? 'error' : 'description', text: txt });
    };
    const generatePairing = async (item: MenuItem) => {
        if(aiLoading) return;
        const txt = await callGeminiApi("Sommelier.", `Pairing for ${item.name}: ${item.description}`);
        setAiResult({ dishName: item.name, type: txt.includes("disabled") ? 'error' : 'pairing', text: txt });
    };

    // --- Render Helpers ---
    const OrderStatusMessage = ({ status }: { status: string | null }) => {
        if (!status) return null;
        let color = 'bg-red-500', text = status, Icon = XCircle;
        
        // Match specific success/error codes to user-friendly text
        if (status === 'payment_success') { color = 'bg-emerald-600'; text = 'Payment Successful! Order Confirmed.'; Icon = DollarSign; }
        else if (status === 'payment_success_demo') { color = 'bg-blue-600'; text = 'Payment Successful! (Demo Mode)'; Icon = WifiOff; }
        else if (status === 'payment_failed') { text = 'Payment Failed. Please try again.'; }
        else if (status === 'owner_login_success') { color = 'bg-green-500'; text = 'Owner Access Granted.'; Icon = CheckCheck; }
        else if (status === 'owner_login_failed') { text = 'Login Failed. Invalid Credentials.'; Icon = XCircle; }
        else if (status === 'owner_login_blocked') { text = 'Too many attempts. Account temporarily blocked.'; Icon = AlertTriangle; color = 'bg-amber-600'; }
        else if (status === 'owner_signout_success') { color = 'bg-blue-500'; text = 'Signed Out.'; Icon = LogOut; }
        else if (status === 'db_permission_error_read') { text = 'Dashboard: Access Denied.'; }
        else if (status === 'success_menu_update') { color = 'bg-green-600'; text = 'Menu Updated Successfully.'; Icon = CheckCheck; }
        else if (status === 'success_menu_update_local') { color = 'bg-blue-600'; text = 'Menu Saved Locally (Offline Mode).'; Icon = HardDrive; }
        else if (status === 'success_menu_delete') { color = 'bg-green-600'; text = 'Menu Item Deleted.'; Icon = Trash2; }
        else if (status === 'success_history_cleaned') { color = 'bg-green-600'; text = 'History Cleaned Successfully.'; Icon = Trash2; }
        
        return (
            <div className={`fixed top-4 right-4 z-50 p-4 rounded-xl text-white font-semibold flex items-center shadow-2xl max-w-sm ${color}`}>
                <Icon className="w-6 h-6 mr-3 flex-shrink-0" /> <span className="text-sm break-words">{text}</span>
            </div>
        );
    };

    const NavButton = ({ sectionName, label, IconComponent, count, isOwner = false }: any) => {
        const activeClasses = activeSection === sectionName ? `shadow-2xl ring-4 ${isOwner?'ring-gray-400':'ring-purple-400'} scale-105 ring-offset-4 ring-offset-gray-100` : `${isOwner?'hover:bg-gray-900':'hover:bg-purple-700'} shadow-lg`;
        return (
            <button onClick={() => setActiveSection(sectionName)} className={`w-24 h-24 md:w-28 md:h-28 rounded-full flex flex-col items-center justify-center font-semibold text-white text-xs md:text-sm font-sans transition duration-300 transform flex-shrink-0 ${isOwner?'bg-gray-800':'bg-purple-600'} ${activeClasses}`}>
                <IconComponent className="mb-1" size={24} /> <span>{count ? `${label} (${count})` : label}</span>
            </button>
        );
    };

    const MobileNavButton = ({ sectionName, IconComponent, count = 0, label }: any) => (
        <button onClick={() => setActiveSection(sectionName)} className={`flex flex-col items-center p-2 transition-colors duration-200 relative ${activeSection === sectionName ? 'text-purple-600' : 'text-gray-500 hover:text-purple-600'} w-full`}>
            {activeSection === sectionName && <div className={`absolute top-0 w-8 h-1 rounded-b-full ${sectionName === 'dashboard' ? 'border-gray-800' : 'border-purple-600'}`}></div>}
            <IconComponent className="w-6 h-6" />
            {count > 0 && sectionName === 'cart' && <span className="absolute top-1 right-3 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">{count}</span>}
            <span className="text-[10px] mt-1 font-semibold">{label}</span>
        </button>
    );

    const OwnerLogin = () => {
        const [e, setE] = useState(''); const [p, setP] = useState('');
        const [showPassword, setShowPassword] = useState(false);
        return (
            <div className="max-w-md mx-auto p-10 bg-white rounded-2xl shadow-2xl text-center mt-16">
                <ChefHat className="w-12 h-12 mx-auto mb-4 text-gray-800" /><h2 className="text-2xl font-extrabold mb-6">Owner Login</h2>
                <form onSubmit={(evt) => { evt.preventDefault(); handleOwnerSignIn(e, p); }} className="space-y-4">
                    <input type="email" placeholder="Email" value={e} onChange={ev=>setE(ev.target.value)} className="w-full p-3 border rounded" required/>
                    <div className="relative">
                        <input type={showPassword ? "text" : "password"} placeholder="Password" value={p} onChange={ev=>setP(ev.target.value)} className="w-full p-3 border rounded pr-10" required />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700">{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button>
                    </div>
                    <button className="w-full bg-gray-800 text-white font-bold py-3 rounded shadow">Sign In</button>
                </form>
            </div>
        );
    };

    const KitchenOrderTicket = ({ order }: { order: Order }) => {
        const isPaid = order.status === 'Paid'; const isWorking = order.status !== 'Done';
        const updateStatus = (s: string) => updateDoc(doc(db, `artifacts/${appId}/public/data/orders`, order.id), { status: s });
        return (
            <div className={`p-4 shadow-lg rounded-xl flex flex-col justify-between ${isWorking ? (isPaid ? 'bg-indigo-50 border-t-4 border-indigo-500' : 'bg-amber-50 border-t-4 border-amber-500') : 'bg-green-50 border-t-4 border-green-500'}`}>
                <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-bold text-gray-800">#{order.id.substring(0,8)}</h3>
                    <span className={`text-xs px-2 py-1 rounded-full font-bold ${isWorking ? (isPaid ? 'bg-indigo-200 text-indigo-800':'bg-amber-200 text-amber-800') : 'bg-green-200 text-green-800'}`}>{isPaid?'PAID':(isWorking?'UNPAID':'READY')}</span>
                </div>
                <p className="text-xl font-extrabold">{order.customerName}</p>
                <p className="text-xs text-gray-500 mb-1">{order.timestamp?.seconds ? new Date(order.timestamp.seconds*1000).toLocaleString() : 'N/A'}</p>
                <p className="text-lg font-bold text-purple-700 mb-3">${order.totalAmount.toFixed(2)}</p>
                <div className="text-sm mb-4">{order.items.map((i,x)=><div key={x}>{i.quantity}x <b>{i.name}</b></div>)}</div>
                {isWorking ? (
                    <button onClick={()=>updateStatus('Done')} className="w-full bg-emerald-600 text-white py-2 rounded font-bold"><CheckCheck className="inline w-4 h-4"/> Done</button>
                ) : (
                    <div className="flex gap-2">
                        <button onClick={()=>updateStatus(isPaid?'Paid':'Pending Payment/Unpaid')} className="flex-1 bg-sky-100 text-sky-800 py-2 rounded font-bold"><RefreshCw className="inline w-4 h-4"/> Undo</button>
                        <button onClick={() => handleArchiveOrder(order)} className="bg-gray-500 text-white px-4 py-2 rounded font-bold hover:bg-gray-700 flex items-center justify-center tooltip" title="Archive to History"><Archive className="inline w-4 h-4"/></button>
                    </div>
                )}
            </div>
        );
    };

    // --- Page Renderers ---
    const renderHome = () => (
        <div className="text-center py-16 px-4 bg-purple-50 rounded-2xl shadow-xl relative overflow-hidden">
            <ChefHat className="w-16 h-16 mx-auto mb-4 text-purple-600" /><h2 className="text-6xl font-extrabold font-serif mb-4">The Saffron Table</h2>
            <p className="text-xl text-gray-600 mb-8">Experience the rich flavors and aromatic traditions.</p>
            <div className="flex justify-center gap-6">
                <button onClick={()=>setActiveSection('menu')} className="bg-purple-600 text-white font-bold py-3 px-8 rounded-full shadow-lg transform hover:scale-105 transition">View Full Menu</button>
                <button onClick={()=>setActiveSection('dashboard')} className="bg-gray-800 text-white font-bold py-3 px-8 rounded-full shadow-lg transform hover:scale-105 transition flex items-center"><ChefHat className="mr-2"/> Owner</button>
            </div>
        </div>
    );

    const renderMenu = () => (
        <div className="space-y-12">
            <h2 className="text-4xl font-extrabold font-sans flex items-center"><Utensils className="w-8 h-8 mr-3 text-purple-600"/> The Persian Feast Menu</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                {menuItems.map(item => (
                    <div key={item.id || item.name} className="bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col">
                        <img src={item.image} className="w-full h-48 object-cover" onError={(e)=>{e.currentTarget.src="https://placehold.co/400x192?text=Dish"}}/>
                        <div className="p-6 flex flex-col flex-grow">
                            <div className="flex justify-between font-bold mb-2"><h3 className="text-2xl font-serif">{item.name}</h3><span className="text-xl text-purple-600">${item.price.toFixed(2)}</span></div>
                            <p className="text-gray-600 text-sm mb-4 flex-grow">{item.description}</p>
                            <div className="flex gap-2 mb-4">
                                <button onClick={()=>generateDescription(item)} className="flex-1 bg-purple-100 text-purple-700 text-xs py-1 rounded">{aiLoading && aiResult?.dishName === item.name && aiResult.type === 'description' ? <Loader2 className="animate-spin mx-auto w-4 h-4"/> : "Poetic Desc"}</button>
                                <button onClick={()=>generatePairing(item)} className="flex-1 bg-purple-100 text-purple-700 text-xs py-1 rounded">{aiLoading && aiResult?.dishName === item.name && aiResult.type === 'pairing' ? <Loader2 className="animate-spin mx-auto w-4 h-4"/> : "Pairing"}</button>
                            </div>
                            {aiResult && aiResult.dishName === item.name && <div className={`p-3 mb-2 text-sm rounded ${aiResult.type==='error'?'bg-red-100':'bg-green-50'}`} dangerouslySetInnerHTML={{__html: aiResult.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}}/>}
                            <button onClick={()=>handleAddToCart(item)} className="w-full bg-purple-600 text-white font-bold py-3 rounded-xl shadow-lg hover:bg-purple-700 transition transform hover:scale-[1.01]"><ShoppingCart className="inline mr-2"/> Add to Cart</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderCart = () => (
        <div className="max-w-4xl mx-auto space-y-8">
            <h2 className="text-4xl font-extrabold font-sans flex items-center"><ShoppingCart className="w-8 h-8 mr-3 text-purple-600"/> Your Order Basket</h2>
            {cartItems.length===0 ? (
                <div className="text-center p-12 bg-gray-50 rounded-2xl"><p className="text-xl text-gray-500">Cart is empty.</p><button onClick={()=>setActiveSection('menu')} className="mt-6 bg-purple-600 text-white font-bold py-3 px-6 rounded-xl">View Menu</button></div>
            ) : (
                <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-xl p-4 divide-y divide-purple-100">
                        {cartItems.map(i=>(
                            <div key={i.name} className="flex justify-between items-center py-4">
                                <div className="flex items-center gap-4"><img src={i.image} className="w-16 h-16 rounded object-cover"/><div><p className="font-bold">{i.name}</p><p className="text-sm">${i.price.toFixed(2)}</p></div></div>
                                <div className="flex items-center gap-3 border rounded-full p-1">
                                    <button onClick={()=>updateQuantity(i.name, i.quantity-1)} className="p-2 text-purple-600"><Minus size={16}/></button><span className="font-bold">{i.quantity}</span><button onClick={()=>updateQuantity(i.name, i.quantity+1)} className="p-2 text-purple-600"><Plus size={16}/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                    {/* 🚀 CALLS SMART HANDLER - WILL FAIL IF BACKEND MISSING */}
                    <button onClick={handleProceedToCheckout} className="w-full bg-green-500 text-white font-bold py-4 rounded-xl shadow-lg text-xl"><CreditCard className="inline mr-2"/> Proceed to Checkout (${calculateTotal().toFixed(2)})</button>
                </div>
            )}
        </div>
    );

    const renderCheckout = () => {
        // 🚀 FIX: We REMOVED the "if (activeSection !== 'checkout') return null;" line.
        // This keeps the Stripe component alive in the background (via display:none),
        // preventing the crash when you navigate away and come back.
        
        return (
            <div className="space-y-8 max-w-xl mx-auto">
                <h2 className="text-4xl font-extrabold text-gray-900 font-sans flex items-center"><ListOrdered className="w-8 h-8 mr-3 text-purple-600" /> Checkout</h2>
                <div className="bg-white p-8 rounded-2xl shadow-xl">
                    <StripePaymentSection 
                        clientSecret={paymentIntentClientSecret} 
                        cartItems={cartItems} 
                        customerInfo={customerInfo} 
                        setCustomerInfo={setCustomerInfo} 
                        totalAmount={calculateTotal()} 
                        userId={userId || 'guest'} 
                        db={db} 
                        appId={appId} 
                        onSuccess={(status: string) => { 
                            setCartItems([]); 
                            setPaymentIntentClientSecret(null); // 🚀 FORCE CLEAR SECRETS ON SUCCESS
                            setOrderStatus(status); 
                            setActiveSection('menu'); 
                        }} 
                        onError={(err: string) => setOrderStatus(err)} 
                        refreshKey={stripeRefreshKey} // 🚀 Pass key to force fresh mount
                    />
                </div>
                <button onClick={() => setActiveSection('cart')} className="w-full text-sm text-gray-500 hover:text-purple-600 transition font-medium flex items-center justify-center pt-2">&larr; Back to Cart</button>
            </div>
        );
    };

    const renderDashboard = () => {
        if (!isOwner) return <OwnerLogin />;
        
        return (
            <div className="space-y-8">
                <div className="flex justify-between items-center flex-wrap gap-4">
                    <h2 className="text-4xl font-extrabold flex items-center"><ChefHat className="mr-3"/> Owner Dashboard</h2>
                    <div className="flex gap-4">
                        <div className="flex bg-gray-200 rounded-lg p-1">
                            <button onClick={()=>setDashboardTab('orders')} className={`px-4 py-2 rounded-lg font-bold transition ${dashboardTab==='orders'?'bg-white text-gray-900 shadow':'text-gray-500 hover:text-gray-900'}`}>Orders</button>
                            <button onClick={()=>setDashboardTab('menu')} className={`px-4 py-2 rounded-lg font-bold transition ${dashboardTab==='menu'?'bg-white text-gray-900 shadow':'text-gray-500 hover:text-gray-900'}`}>Menu Manager</button>
                            <button onClick={()=>setDashboardTab('history')} className={`px-4 py-2 rounded-lg font-bold transition ${dashboardTab==='history'?'bg-white text-gray-900 shadow':'text-gray-500 hover:text-gray-900'}`}>History</button>
                        </div>
                        <button onClick={handleSignOut} className="bg-red-600 text-white font-bold py-2 px-4 rounded-xl shadow">Sign Out</button>
                    </div>
                </div>

                {dashboardTab === 'orders' ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white p-5 rounded-xl shadow-2xl"><h2 className="text-2xl font-bold text-amber-700 mb-4 border-b-4 border-amber-500 pb-2">Working On ({orders.filter(o=>o.status!=='Done').length})</h2><div className="space-y-4">{orders.filter(o=>o.status!=='Done').map(o=><KitchenOrderTicket key={o.id} order={o}/>)}</div></div>
                        <div className="bg-white p-5 rounded-xl shadow-2xl"><h2 className="text-2xl font-bold text-green-700 mb-4 border-b-4 border-green-500 pb-2">Done ({orders.filter(o=>o.status==='Done').length})</h2><div className="space-y-4">{orders.filter(o=>o.status==='Done').map(o=><KitchenOrderTicket key={o.id} order={o}/>)}</div></div>
                    </div>
                ) : dashboardTab === 'history' ? (
                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-xl flex flex-col md:flex-row justify-between items-center gap-4">
                            <div>
                                <h3 className="text-2xl font-bold flex items-center text-gray-800"><History className="mr-2"/> Order History</h3>
                                <p className="text-gray-500 text-sm">Archived orders that have been picked up or deleted from the main list.</p>
                            </div>
                            <div className="flex flex-wrap gap-2 items-center">
                                <span className="text-sm font-bold text-gray-600 mr-2 flex items-center"><Trash2 size={16} className="mr-1"/> Clean up History:</span>
                                <button onClick={() => handleCleanHistory('1w')} disabled={isCleaningHistory} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1 rounded text-xs font-bold transition border border-gray-300">Keep Last Week Only</button>
                                <button onClick={() => handleCleanHistory('2w')} disabled={isCleaningHistory} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1 rounded text-xs font-bold transition border border-gray-300">Keep Last 2 Weeks</button>
                                <button onClick={() => handleCleanHistory('3w')} disabled={isCleaningHistory} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1 rounded text-xs font-bold transition border border-gray-300">Keep Last 3 Weeks</button>
                                <button onClick={() => handleCleanHistory('1m')} disabled={isCleaningHistory} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1 rounded text-xs font-bold transition border border-gray-300">Keep Last Month</button>
                                <button onClick={() => handleCleanHistory('all')} disabled={isCleaningHistory} className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1 rounded text-xs font-bold transition border border-red-200">Delete Entire History</button>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl shadow-xl overflow-hidden">
                            {historyOrders.length === 0 ? (
                                <div className="p-12 text-center text-gray-400 font-bold">No history available.</div>
                            ) : (
                                <div className="divide-y divide-gray-100">
                                    {historyOrders.map(order => (
                                        <div key={order.id} className="p-4 hover:bg-gray-50 flex flex-col md:flex-row justify-between items-start gap-4">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                    <span className="font-mono text-xs bg-gray-200 px-2 py-1 rounded text-gray-700">#{order.id.substring(0,6)}</span>
                                                    <span className="text-xs text-gray-600 flex items-center" title="Created At"><Calendar size={12} className="mr-1"/> Created: {order.timestamp?.seconds ? new Date(order.timestamp.seconds*1000).toLocaleString() : 'N/A'}</span>
                                                    <span className="text-xs text-gray-400 flex items-center" title="Archived At"><Archive size={12} className="mr-1"/> Archived: {order.archivedAt ? new Date(typeof order.archivedAt === 'number' ? order.archivedAt : (order.archivedAt as FirestoreTimestamp).seconds * 1000).toLocaleString() : 'N/A'}</span>
                                                </div>
                                                <div className="font-bold text-gray-800 mb-2">{order.customerName} <span className="font-normal text-gray-500 text-sm">({order.items.length} items)</span></div>
                                                <div className="mt-2 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                                                    {order.items.map((item, idx) => (
                                                        <div key={idx} className="flex justify-between"><span>{item.quantity}x {item.name}</span><span className="text-gray-500">${item.subtotal.toFixed(2)}</span></div>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col justify-between h-full">
                                                <div className="font-bold text-purple-700 text-lg">${order.totalAmount.toFixed(2)}</div>
                                              {order.payment?.last4 && (
                                            <div className="flex items-center justify-end gap-1 text-xs text-gray-500 mt-1 font-mono bg-gray-100 px-2 py-1 rounded self-end">
                                                <CreditCard size={12} className="text-gray-400" /><span className="capitalize font-semibold">{order.payment.brand}</span><span className="tracking-widest">•••• {order.payment.last4}</span>
                                                        {order.payment.expMonth && order.payment.expYear && (<span className="ml-2 text-gray-600">{String(order.payment.expMonth).padStart(2, '0')}/{order.payment.expYear}</span>)}
                                                         </div>
                                                    )}
                                                <div className="text-xs text-green-600 font-bold uppercase mt-1">{order.status}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-8">
                        <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
                             <div><h3 className="text-xl font-bold flex items-center"><Edit className="mr-2"/> Menu Editor</h3><p className="text-xs text-gray-500">Add or remove items below. Changes are local until you click Save.</p></div>
                             {hasUnsavedChanges ? (
                                <button onClick={handleSaveChanges} disabled={isSaving} className="bg-green-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:bg-green-700 transition flex items-center animate-pulse">{isSaving ? <Loader2 className="animate-spin mr-2"/> : <Save className="mr-2"/>} Save Changes</button>
                             ) : (
                                <button disabled className="bg-gray-300 text-gray-500 font-bold py-3 px-6 rounded-xl flex items-center cursor-not-allowed"><CheckCheck className="mr-2"/> All Saved</button>
                             )}
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-xl">
                            <h3 className="text-xl font-bold mb-4 flex items-center"><Plus className="mr-2"/> Add New Item</h3>
                            <form onSubmit={handleLocalAddItem} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <input placeholder="Dish Name" className="p-3 border rounded" value={newItem.name} onChange={e=>setNewItem({...newItem, name: e.target.value})} required />
                                <input placeholder="Price (e.g. 15.50)" type="number" step="0.01" className="p-3 border rounded" value={newItem.price} onChange={e=>setNewItem({...newItem, price: e.target.value})} required />
                                <input placeholder="Image URL (Optional)" className="p-3 border rounded" value={newItem.image} onChange={e=>setNewItem({...newItem, image: e.target.value})} />
                                <input placeholder="Description" className="p-3 border rounded" value={newItem.description} onChange={e=>setNewItem({...newItem, description: e.target.value})} />
                                <button type="submit" disabled={isAddingItem} className="md:col-span-2 bg-gray-900 text-white font-bold py-3 rounded hover:bg-black transition flex items-center justify-center">{isAddingItem ? <Loader2 className="animate-spin mr-2"/> : <Plus className="mr-2"/>} Add Item (Draft)</button>
                            </form>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {dashboardMenuItems.map((item, index) => (
                                <div key={item.id || `new_${index}`} className={`bg-white p-4 rounded-xl shadow flex items-center gap-4 relative group ${!item.id ? 'border-2 border-green-400 bg-green-50' : ''}`}>
                                    <img src={item.image} className="w-16 h-16 rounded-lg object-cover" onError={e=>e.currentTarget.src="https://placehold.co/64x64?text=Dish"}/>
                                    <div className="flex-grow">
                                        <h4 className="font-bold">{item.name} { !item.id && <span className="text-[10px] bg-green-200 text-green-800 px-1 rounded ml-1">NEW</span>}</h4>
                                        <p className="text-sm text-gray-500">${item.price.toFixed(2)}</p>
                                    </div>
                                    <button onClick={() => handleLocalDeleteByIndex(index)} className="bg-red-100 text-red-600 p-2 rounded-lg hover:bg-red-200 transition"><Trash2 size={18}/></button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderContent = () => {
        switch (activeSection) {
            case 'home': return renderHome();
            case 'menu': return renderMenu();
            case 'cart': return renderCart();
            case 'checkout': return renderCheckout();
            case 'dashboard': return renderDashboard();
            default: return renderHome();
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 font-sans flex flex-col">
            <OrderStatusMessage status={orderStatus} />
            <div className="hidden md:flex bg-white shadow-xl p-6 border-r fixed top-0 left-0 h-full flex-col space-y-6 z-10 w-[140px] lg:w-[180px]">
                <div className="text-center py-4"><h1 className="text-3xl font-extrabold text-purple-700 font-serif">Saffron</h1><h2 className="text-sm text-gray-500">The Table</h2></div>
                <div className="flex flex-col space-y-6 flex-grow">
                    <NavButton sectionName="home" label="Home" IconComponent={Home} />
                    <NavButton sectionName="menu" label="Menu" IconComponent={BookOpen} />
                    <NavButton sectionName="cart" label="Cart" IconComponent={ShoppingCart} count={cartItems.length} />
                    {cartItems.length>0 && activeSection !== 'dashboard' && <NavButton sectionName="checkout" label="Checkout" IconComponent={DollarSign} />}
                </div>
                <div className="pt-6 border-t border-gray-200"><NavButton sectionName="dashboard" label="Dashboard" IconComponent={ChefHat} count={orders.length} isOwner={true} /></div>
            </div>
            <main className="flex-grow p-4 md:p-8 md:ml-[140px] lg:ml-[180px] mt-16 md:mt-0">
                {isAppReady ? (
                    <div className="container mx-auto max-w-7xl pt-4 pb-20 md:pb-0">
                        {/* 🚀 ONLY ONE VIEW ACTIVE AT A TIME TO PREVENT CRASHES */}
                        <div style={{ display: activeSection === 'home' ? 'block' : 'none' }}>{renderHome()}</div>
                        <div style={{ display: activeSection === 'menu' ? 'block' : 'none' }}>{renderMenu()}</div>
                        <div style={{ display: activeSection === 'cart' ? 'block' : 'none' }}>{renderCart()}</div>
                        <div style={{ display: activeSection === 'checkout' ? 'block' : 'none' }}>{renderCheckout()}</div>
                        <div style={{ display: activeSection === 'dashboard' ? 'block' : 'none' }}>{renderDashboard()}</div>
                    </div>
                ) : <div className="flex justify-center items-center h-[50vh] text-purple-600 text-xl font-bold"><Loader2 className="animate-spin mr-3"/> Loading...</div>}
            </main>
            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t shadow-2xl z-20">
                <div className="flex justify-around h-16 items-center">
                    <MobileNavButton sectionName="home" label="Home" IconComponent={Home} />
                    <MobileNavButton sectionName="menu" label="Menu" IconComponent={BookOpen} />
                    <MobileNavButton sectionName="cart" label="Cart" IconComponent={ShoppingCart} count={cartItems.length} />
                    <MobileNavButton sectionName="dashboard" label="Owner" IconComponent={ChefHat} />
                </div>
            </div>
        </div>
    );
}