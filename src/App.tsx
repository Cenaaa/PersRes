import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
    ChefHat, Utensils, Home, BookOpen, ShoppingCart, Plus, Minus, XCircle, 
    DollarSign, ListOrdered, Loader2, CheckCheck, CreditCard, AlertTriangle, 
    RefreshCw, Trash2, LogOut, Edit, WifiOff, Save, History, Calendar, Archive,
    ShoppingBag, Package, Truck, Tag, Box, X, Eye, EyeOff, LogIn, UserPlus, Layers, Filter, Search, ChevronRight, ChevronDown, ChevronLeft, Sparkles, Star, Zap, Check, ArrowLeft, Wand2, ArrowUp, Settings2, GripVertical, Lightbulb, Image as ImageIcon, Video, Upload, Link as LinkIcon
} from 'lucide-react';

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
    setDoc,
    increment,
    writeBatch,
    runTransaction
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

// --- STRIPE IMPORTS ---
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

// ====================================================================================
// 1. MASTER CONFIGURATION
// ====================================================================================

const STORE_CONFIG = {
    // 🟢 SWITCH HERE: 'restaurant' OR 'retail'
    type: 'retail' as 'restaurant' | 'retail', 
    
    name: "Saffron Table",
    description: "Experience the rich flavors and aromatic traditions.",
    currencySymbol: "$",
    
    content: {
        restaurant: {
            item: "Dish", menu: "Menu", cart: "Tray", action: "Cook", fulfillment: "Table / Notes",
            iconBrand: ChefHat, iconMenu: BookOpen, iconFulfill: Utensils
        },
        retail: {
            item: "Product", menu: "Catalog", cart: "Cart", action: "Pack", fulfillment: "Shipping",
            iconBrand: ShoppingBag, iconMenu: Tag, iconFulfill: Package
        }
    }
};

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

// --- UTILS ---
const normalize = (str: string) => str.trim().toLowerCase();
const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();

// 🟢 TITLE CASE FORMATTER
const toTitleCase = (str: string) => {
    return str.replace(
        /\w\S*/g,
        text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
    );
};

// 🟢 LEVENSHTEIN DISTANCE
const getLevenshteinDistance = (a: string, b: string) => {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
};

const KNOWN_ATTRIBUTES_LIST = [
    'Department', 'Category', 'Type', 'Gender', 'Brand', 'Material', 'Style', 
    'Color', 'Size', 'Dietary', 'Spiciness', 'Temperature', 'Occasion', 'Fit', 'Pattern'
];

const GLOBAL_PRESETS: Record<string, string[]> = {
    'gender': ['Men', 'Women', 'Kids', 'Unisex'],
    'temp': ['Hot', 'Cold'],
    'spiciness': ['Mild', 'Medium', 'Hot'],
    'type': ['Main', 'Appetizer', 'Drink', 'Dessert'],
    'department': ['Shirts', 'Pants', 'Shoes', 'Accessories'],
    'brand': ['Nike', 'Adidas', 'Puma', 'Gucci'],
    'color': ['Black', 'White', 'Red', 'Blue', 'Green', 'Multi']
};

const CONTEXT_PRESETS: Record<string, Record<string, string[]>> = {
    'size': {
        'shoes': ['US 6', 'US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12'],
        'footwear': ['US 6', 'US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12'],
        'boots': ['US 6', 'US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12'],
        'sneakers': ['US 6', 'US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12'],
        'shirt': ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        'shirts': ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        'pants': ['28', '30', '32', '34', '36', '38'],
        'clothing': ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    }
};

const AI_SORT_HIERARCHY = [
    'department', 'category', 'type', 'gender', 'brand', 'material', 'style', 'color', 'pattern', 'size'
];

const VISUAL_VARIANT_ATTRIBUTES = ['color', 'pattern', 'style'];

// --- TYPES ---
interface Characteristic { 
    name: string; 
    values: string[]; 
    isCategory: boolean; 
    isLead?: boolean;
}

interface MediaItem {
    type: 'image' | 'video';
    url: string;
}

interface MenuItem { 
    id?: string; 
    name: string; 
    description: string; 
    price: number; 
    image: string; 
    stock: number; 
    trackStock: boolean; 
    characteristics?: Characteristic[]; 
    sortMode?: 'manual' | 'auto';
    media?: MediaItem[];
}
interface CartItem extends MenuItem { quantity: number; selectedOptions?: Record<string, string>; }
interface OrderItem { id?: string; name: string; quantity: number; price: number; subtotal: number; selectedOptions?: Record<string, string>; trackStock?: boolean; }
interface FirestoreTimestamp { seconds: number; nanoseconds: number; }

interface Order {
    id: string; userId: string; customerName: string; customerPhone: string; customerEmail: string;
    fulfillment?: { type: 'delivery' | 'shipping'; instructions?: string; address?: { street: string; city: string; zip: string; } } | null;
    deliveryInstructions?: string | null; 
    items: OrderItem[]; totalAmount: number; status: string; 
    payment: { method: string; transactionId: string; brand?: string; last4?: string; expMonth?: number | null; expYear?: number | null; };
    timestamp: FirestoreTimestamp | null; archivedAt?: FirestoreTimestamp | number | Date | null; 
}

type AiResult = { dishName: string; type: 'description' | 'pairing' | 'error'; text: string; } | null;

const DEFAULT_MENU_ITEMS: MenuItem[] = [];


// ====================================================================================
// 1.5 CATALOG GROUPING (MENU/CATALOG PAGE ONLY)
// Groups items by same Name + same Picture (primary image). Within a group, common
// characteristics are shown once; differing characteristic values are aggregated (e.g. "US 8 | US 11").
// Out-of-stock variants (trackStock && stock <= 0) are excluded; if all variants are excluded,
// the entire grouped entry disappears from the catalog.
// ====================================================================================
type CatalogGroup = { key: string; item: MenuItem; variants: MenuItem[] };

const getPrimaryImageUrl = (item: MenuItem): string => {
    const mediaImg = item.media?.find(m => m.type === 'image')?.url;
    return (mediaImg || item.image || '').trim();
};

const groupMenuItemsForCatalog = (items: MenuItem[]): CatalogGroup[] => {
    const groups: CatalogGroup[] = [];
    const indexByKey = new Map<string, number>();

    for (const it of items) {
        // Exclude out-of-stock variants from grouping (catalog should not list unavailable variants).
        if (it.trackStock && (it.stock ?? 0) <= 0) continue;

        const key = `${normalize(it.name)}||${normalize(getPrimaryImageUrl(it))}`;
        const existingIndex = indexByKey.get(key);

        if (existingIndex === undefined) {
            // Start a new group
            const base: MenuItem = it;

            // Build aggregated characteristics from base ordering
            const baseChars = base.characteristics || [];
            const aggregatedChars: Characteristic[] = baseChars.map((ch, idx) => {
                if (idx === 0) return ch; // preserve lead/category marker as-is
                const values: string[] = [];
                for (const v of items) {
                    // Only consider variants that belong to this group key and are in stock
                    if ((v.trackStock && (v.stock ?? 0) <= 0)) continue;
                    const vKey = `${normalize(v.name)}||${normalize(getPrimaryImageUrl(v))}`;
                    if (vKey !== key) continue;
                    const match = (v.characteristics || []).find(c => normalize(c.name) === normalize(ch.name));
                    const val = (match?.values || [])[0];
                    if (val && !values.includes(val)) values.push(val);
                }
                // Fallback to base value if nothing collected (should be rare)
                const finalValues = values.length > 0 ? values : (ch.values || []).slice(0, 1);
                return { ...ch, values: finalValues };
            });

            const group: CatalogGroup = {
                key,
                item: { ...base, characteristics: aggregatedChars },
                variants: [it],
            };
            groups.push(group);
            indexByKey.set(key, groups.length - 1);
        } else {
            groups[existingIndex].variants.push(it);
        }
    }

    return groups;
};

// ====================================================================================
// 2. ERROR BOUNDARY
// ====================================================================================
class GlobalErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
    constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
    componentDidCatch(error: any) { console.error("APP CRASH:", error); }
    render() {
        if (this.state.hasError) return (
            <div className="flex items-center justify-center h-screen bg-gray-50 text-center p-8">
                <div>
                    <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4"/>
                    <h2 className="text-xl font-bold">Something went wrong</h2>
                    <p className="text-gray-500 my-4 text-sm max-w-md">{this.state.error?.toString() || "Unknown Error"}</p>
                    <button onClick={() => window.location.reload()} className="bg-purple-600 text-white px-6 py-2 rounded-lg font-bold">Reload App</button>
                </div>
            </div>
        );
        return this.props.children;
    }
}

class StripeErrorBoundary extends React.Component<{ children: React.ReactNode, onError: (msg: string) => void }, { hasError: boolean }> {
    constructor(props: any) { super(props); this.state = { hasError: false }; }
    static getDerivedStateFromError(error: any) { return { hasError: true }; }
    componentDidCatch(error: any) { console.error("Stripe Error:", error); this.props.onError("Payment System Error. Refresh."); }
    render() {
        if (this.state.hasError) return <div className="p-4 bg-red-100 text-red-800 rounded">Payment Error. Please Refresh.</div>;
        return this.props.children;
    }
}

// ====================================================================================
// 3. ISOLATED COMPONENTS (ALL MUST BE BEFORE APP CONTENT)
// ====================================================================================

const OwnerLogin = ({ onLogin }: { onLogin: (e:string, p:string)=>Promise<boolean> }) => {
    const [email, setEmail] = useState(''); 
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        await onLogin(email, password);
        setIsLoading(false);
    };

    return (
        <div className="max-w-md mx-auto p-10 bg-white rounded-2xl shadow-2xl text-center mt-16 animate-fade-in">
            <ChefHat className="w-12 h-12 mx-auto mb-4 text-gray-800" />
            <h2 className="text-2xl font-extrabold mb-2">Owner Login</h2>
            <p className="text-gray-500 text-sm mb-6">Enter your credentials to access the dashboard.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
                <input type="email" placeholder="Email Address" value={email} onChange={ev=>setEmail(ev.target.value)} className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none transition" required/>
                <div className="relative">
                    <input type={showPassword ? "text" : "password"} placeholder="Password" value={password} onChange={ev=>setPassword(ev.target.value)} className="w-full p-3 border rounded-lg pr-10 focus:ring-2 focus:ring-purple-500 outline-none transition" required />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600">{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button>
                </div>
                <button disabled={isLoading} className="w-full bg-gray-900 text-white font-bold py-3 rounded-lg shadow-lg hover:bg-black transition transform hover:scale-[1.02] flex items-center justify-center">
                    {isLoading ? <Loader2 className="animate-spin mr-2"/> : <LogIn className="mr-2 w-5 h-5"/>} Sign In
                </button>
            </form>
        </div>
    );
};

const CheckoutForm = ({ cartItems, customerInfo, setCustomerInfo, totalAmount, userId, db, appId, onSuccess, onError }: any) => {
    const stripe = useStripe(); const elements = useElements();
    const [isProcessing, setIsProcessing] = useState(false); const [isElementReady, setIsElementReady] = useState(false); 
    const inputClass = "w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500";
    const labels = STORE_CONFIG.content[STORE_CONFIG.type];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); if (!stripe || !elements) return; setIsProcessing(true);
        try {
            const { error, paymentIntent } = await stripe.confirmPayment({
                elements, confirmParams: { return_url: window.location.href, payment_method_data: { billing_details: { name: customerInfo.name, email: customerInfo.email, phone: customerInfo.phone } } }, redirect: "if_required",
            });
            if (error) { onError(error.message || "Payment failed"); } 
            else if (paymentIntent && paymentIntent.status === "succeeded") {
                let cardBrand = 'Card'; let cardLast4 = 'Paid'; let cardExpMonth = null; let cardExpYear = null;
                try {
                    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntent.id}?client_secret=${paymentIntent.client_secret}&expand[]=payment_method`, { headers: { 'Authorization': `Bearer ${STRIPE_PUBLISHABLE_KEY}` } });
                    const d = await res.json();
                    if (d.payment_method?.card) {
                        cardBrand = d.payment_method.card.brand; cardLast4 = d.payment_method.card.last4; cardExpMonth = d.payment_method.card.exp_month; cardExpYear = d.payment_method.card.exp_year;
                    } 
                } catch (e) { console.error("Card data error", e); }
                if(cardBrand) cardBrand = cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1);

                const fulfillmentData = STORE_CONFIG.type === 'retail' 
                    ? { type: 'shipping', address: { street: customerInfo.street, city: customerInfo.city, zip: customerInfo.zip } }
                    : { type: 'delivery', instructions: customerInfo.instructions || 'None' };

                await addDoc(collection(db, `artifacts/${appId}/public/data/orders`), {
                    userId, customerName: customerInfo.name, customerPhone: customerInfo.phone, customerEmail: customerInfo.email || 'N/A',
                    fulfillment: fulfillmentData,
                    items: cartItems.map((item: any) => ({ 
                        id: item.id,
                        name: item.name, quantity: item.quantity, price: item.price, subtotal: item.price * item.quantity, 
                        selectedOptions: item.selectedOptions || null,
                        trackStock: item.trackStock || false 
                    })),
                    totalAmount, status: 'Paid', 
                    payment: { method: 'Card', transactionId: paymentIntent.id, brand: cardBrand, last4: cardLast4, expMonth: cardExpMonth, expYear: cardExpYear },
                    timestamp: serverTimestamp(),
                });

                // Stock updates: clamp at 0 and prevent negative stock
                for (const item of cartItems) {
                    if (item.id && item.trackStock) {
                        const itemRef = doc(db, `artifacts/${appId}/public/data/menu`, item.id);
                        await runTransaction(db, async (transaction) => {
                            const snap = await transaction.get(itemRef);
                            const current = Number((snap.data() as any)?.stock ?? 0);
                            const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;

                            // If it's already sold out, block further sales.
                            if (safeCurrent <= 0) {
                                throw new Error('OUT_OF_STOCK');
                            }

                            const next = Math.max(0, safeCurrent - item.quantity);
                            transaction.update(itemRef, { stock: next });
                        });
                    }
                }

                onSuccess('payment_success');
            }
        } catch (err: any) { if (String(err?.message||"") === "OUT_OF_STOCK") { onError("Out of stock."); } else { onError("Error processing payment"); } } finally { setIsProcessing(false); }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-purple-50 p-4 rounded-xl border border-purple-200">
                <p className="text-lg font-bold text-purple-800 mb-2">Order Summary</p>
                <div className="flex justify-between text-gray-700 text-sm"><span>{cartItems.length} {labels.item}s</span><span className="text-3xl font-extrabold text-purple-700">${totalAmount.toFixed(2)}</span></div>
            </div>
            <h3 className="text-xl font-bold text-gray-800 pt-2 border-t border-gray-100">{STORE_CONFIG.type === 'retail' ? 'Shipping Details' : 'Contact & Delivery'}</h3>
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input type="text" placeholder="* Name" value={customerInfo.name} onChange={e=>setCustomerInfo({...customerInfo, name: e.target.value})} className={inputClass} required />
                    <input type="tel" placeholder="* Phone" value={customerInfo.phone} onChange={e=>setCustomerInfo({...customerInfo, phone: e.target.value})} className={inputClass} required />
                </div>
                <input type="email" placeholder="Email" value={customerInfo.email} onChange={e=>setCustomerInfo({...customerInfo, email: e.target.value})} className={inputClass} />
                {STORE_CONFIG.type === 'retail' ? (
                    <div className="space-y-4 pt-2">
                        <input type="text" placeholder="* Street Address" value={customerInfo.street} onChange={e=>setCustomerInfo({...customerInfo, street: e.target.value})} className={inputClass} required />
                        <div className="grid grid-cols-2 gap-4">
                            <input type="text" placeholder="* City" value={customerInfo.city} onChange={e=>setCustomerInfo({...customerInfo, city: e.target.value})} className={inputClass} required />
                            <input type="text" placeholder="* Zip" value={customerInfo.zip} onChange={e=>setCustomerInfo({...customerInfo, zip: e.target.value})} className={inputClass} required />
                        </div>
                    </div>
                ) : (
                    <textarea placeholder="Delivery Instructions / Table #" value={customerInfo.instructions} onChange={e=>setCustomerInfo({...customerInfo, instructions: e.target.value})} rows={3} className={inputClass} />
                )}
            </div>
            <h3 className="text-xl font-bold text-gray-800 pt-2 border-t border-gray-100">Payment</h3>
            <div className="bg-white p-4 rounded-xl border border-gray-200 min-h-[100px] relative">
                {!isElementReady && <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 rounded-xl"><Loader2 className="animate-spin text-gray-400 w-8 h-8" /></div>}
                <PaymentElement onReady={()=>setIsElementReady(true)} />
            </div>
            <button disabled={!stripe || !isElementReady || isProcessing} className="w-full bg-purple-600 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-purple-700 disabled:bg-gray-400">{isProcessing ? "Processing..." : `Pay $${totalAmount.toFixed(2)}`}</button>
        </form>
    );
};

const StripePaymentSection = (props: any) => {
    const options = useMemo(() => ({
        clientSecret: props.clientSecret,
        appearance: { theme: 'stripe' as 'stripe', variables: { colorPrimary: '#7e22ce' } },
    }), [props.clientSecret]);

    const [showLongWaitMessage, setShowLongWaitMessage] = useState(false);
    useEffect(() => { let timer: any; if (!props.clientSecret) { timer = setTimeout(() => setShowLongWaitMessage(true), 3000); } else { setShowLongWaitMessage(false); } return () => clearTimeout(timer); }, [props.clientSecret]);
    
    if (!props.clientSecret) return <div className="text-center p-8"><Loader2 className="animate-spin w-8 h-8 text-purple-600 mx-auto"/> <p className="mt-2 text-gray-500">{showLongWaitMessage ? "Server waking up..." : "Loading Secure Payment..."}</p></div>;
    
    return (
        <StripeErrorBoundary onError={props.onError}>
            <Elements stripe={stripePromise} options={options} key={props.refreshKey}>
                <CheckoutForm {...props} />
            </Elements>
        </StripeErrorBoundary>
    );
};

// 🟢 COMPONENT: Menu Grid Item with Carousel
const MenuGridItem = ({ item, onAddToCart }: { item: MenuItem, onAddToCart: (item: MenuItem) => void }) => {
    const [mediaIndex, setMediaIndex] = useState(0);
    const labels = STORE_CONFIG.content[STORE_CONFIG.type];

    const mediaList = item.media && item.media.length > 0 
        ? item.media 
        : [{ type: 'image' as const, url: item.image }];

    const currentMedia = mediaList[mediaIndex];

    const nextSlide = (e: React.MouseEvent) => {
        e.stopPropagation();
        setMediaIndex((prev) => (prev + 1) % mediaList.length);
    };

    const prevSlide = (e: React.MouseEvent) => {
        e.stopPropagation();
        setMediaIndex((prev) => (prev - 1 + mediaList.length) % mediaList.length);
    };

    return (
        <div className="bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-shadow overflow-hidden flex flex-col group border border-gray-100 h-full">
            <div className="relative w-full h-52 bg-gray-100">
                {currentMedia.type === 'video' ? (
                    <video src={currentMedia.url} className="w-full h-full object-cover" autoPlay muted loop playsInline />
                ) : (
                    <img 
                        src={currentMedia.url} 
                        className="w-full h-full object-contain bg-gray-100 transition duration-300" 
                        onError={(e)=>{e.currentTarget.src="https://placehold.co/400x192?text=Item"}}
                        alt={item.name}
                    />
                )}

                {mediaList.length > 1 && (
                    <>
                        <button onClick={prevSlide} className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black/30 hover:bg-black/50 text-white rounded-full p-1.5 transition backdrop-blur-sm z-10"><ChevronLeft size={20} /></button>
                        <button onClick={nextSlide} className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black/30 hover:bg-black/50 text-white rounded-full p-1.5 transition backdrop-blur-sm z-10"><ChevronRight size={20} /></button>
                        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5 z-10">
                            {mediaList.map((_, idx) => (
                                <div key={idx} className={`w-1.5 h-1.5 rounded-full shadow-sm transition-colors ${idx === mediaIndex ? 'bg-white' : 'bg-white/50'}`}/>
                            ))}
                        </div>
                    </>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 pointer-events-none">
                    <h3 className="text-white text-xl font-bold font-serif truncate">{item.name}</h3>
                </div>
            </div>

            <div className="p-5 flex flex-col flex-grow">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-2xl font-bold text-purple-700">${item.price.toFixed(2)}</span>
                </div>
                <p className="text-gray-500 text-sm mb-4 line-clamp-2">{item.description}</p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                    {item.characteristics?.slice(1).map(char => ( 
                        <span key={char.name} className="px-2 py-0.5 text-[10px] uppercase font-bold text-gray-500 bg-gray-100 rounded border border-gray-200">{char.values[0]}</span>
                    ))}
                </div>
                <button onClick={() => onAddToCart(item)} className="mt-auto w-full bg-gray-900 text-white font-bold py-3 rounded-xl shadow hover:bg-black transition flex justify-center items-center group-hover:bg-purple-600">
                    <ShoppingCart size={18} className="mr-2"/> Add to {labels.cart}
                </button>
            </div>
        </div>
    );
}

const GroupedMenuGridItem = ({
    item,
    variantsCount,
    onAction,
    onPreview,
}: {
    item: MenuItem;
    variantsCount: number;
    onAction: () => void;
    onPreview: () => void;
}) => {
    const [mediaIndex, setMediaIndex] = useState(0);
    const labels = STORE_CONFIG.content[STORE_CONFIG.type];

    const mediaList = item.media && item.media.length > 0
        ? item.media
        : [{ type: 'image' as const, url: item.image }];

    const currentMedia = mediaList[mediaIndex];

    const nextSlide = (e: React.MouseEvent) => {
        e.stopPropagation();
        setMediaIndex((prev) => (prev + 1) % mediaList.length);
    };

    const prevSlide = (e: React.MouseEvent) => {
        e.stopPropagation();
        setMediaIndex((prev) => (prev - 1 + mediaList.length) % mediaList.length);
    };

    const displayChars = (item.characteristics || []).slice(1).filter(c => (c.values || []).length > 0);

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onPreview}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPreview();
                }
            }}
            className="bg-white rounded-3xl shadow-xl overflow-hidden transform hover:-translate-y-2 transition duration-300 flex flex-col group cursor-pointer"
        >
            <div className="relative w-full h-52 bg-gray-100">
                {currentMedia.type === 'video' ? (
                    <video src={currentMedia.url} className="w-full h-full object-cover" autoPlay muted loop playsInline />
                ) : (
                    <img
                        src={currentMedia.url}
                        className="w-full h-full object-contain bg-gray-100 transition duration-300"
                        onError={(e) => { e.currentTarget.src = "https://placehold.co/400x192?text=Item"; }}
                        alt={item.name}
                    />
                )}

                {mediaList.length > 1 && (
                    <>
                        <button
                            onClick={prevSlide}
                            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/50 text-white rounded-full p-1.5 transition backdrop-blur-sm z-10"
                            aria-label="Previous"
                        >
                            ‹
                        </button>
                        <button
                            onClick={nextSlide}
                            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/50 text-white rounded-full p-1.5 transition backdrop-blur-sm z-10"
                            aria-label="Next"
                        >
                            ›
                        </button>
                        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5 z-10">
                            {mediaList.map((_, idx) => (
                                <div
                                    key={idx}
                                    className={`w-1.5 h-1.5 rounded-full transition-colors ${idx === mediaIndex ? 'bg-white' : 'bg-white/50'}`}
                                />
                            ))}
                        </div>
                    </>
                )}

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 pointer-events-none">
                    <h3 className="text-white text-xl font-bold font-serif truncate">{item.name}</h3>
                </div>
            </div>

            <div className="p-5 flex flex-col flex-grow">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-2xl font-bold text-purple-700">${item.price.toFixed(2)}</span>
                    <div className="flex items-center gap-2">
                        {variantsCount > 1 && (
                            <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                                {variantsCount} variants
                            </span>
                        )}
                    </div>
                </div>

                <p className="text-gray-500 text-sm mb-4 line-clamp-2">{item.description}</p>

                <div className="space-y-1 mb-4">
                    {displayChars.map(char => (
                        <div
                            key={char.name}
                            className="text-xs font-bold tracking-wide text-gray-800 uppercase"
                        >
                            {char.values.length > 1 ? char.values.join(' | ') : char.values[0]}
                        </div>
                    ))}
                </div>

                <button
                    onClick={(e) => { e.stopPropagation(); onAction(); }}
                    className="mt-auto w-full bg-gray-900 hover:bg-purple-700 text-white font-bold py-3 rounded-xl shadow hover:shadow-lg transition flex justify-center items-center group-hover:bg-purple-600"
                >
                    <ShoppingCart size={18} className="mr-2" /> Add to {labels.cart}
                </button>
            </div>
        </div>
    );
};
;



// 🟢 NEW COMPONENT: Catalog Item Preview Modal (Enlarge on click)
const CatalogItemPreviewModal = ({
    item,
    variantsCount,
    onClose,
    onAddToCart,
}: {
    item: MenuItem;
    variantsCount: number;
    onClose: () => void;
    onAddToCart: () => void;
}) => {
    const [mediaIndex, setMediaIndex] = useState(0);
    const labels = STORE_CONFIG.content[STORE_CONFIG.type];

    const mediaList = item?.media && item.media.length > 0
        ? item.media
        : [{ type: 'image' as const, url: item?.image || '' }];

    const safeIndex = Math.min(mediaIndex, Math.max(0, mediaList.length - 1));
    const currentMedia = mediaList[safeIndex];
    const displayChars = (item?.characteristics || []).slice(1).filter(c => (c.values || []).length > 0);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const goNext = () => setMediaIndex((p) => (p + 1) % mediaList.length);
    const goPrev = () => setMediaIndex((p) => (p - 1 + mediaList.length) % mediaList.length);

    return (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div className="min-w-0">
                        <div className="text-lg md:text-xl font-extrabold truncate">{item?.name}</div>
                        <div className="text-sm text-gray-500">
                            {variantsCount > 1 ? `${variantsCount} variants available` : '1 variant available'}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-gray-100 transition text-gray-600"
                        aria-label="Close"
                    >
                        <X size={22} />
                    </button>
                </div>

                <div className="relative bg-gray-100 flex items-center justify-center w-full h-[52vh] md:h-[56vh] max-h-[560px]">
                    {currentMedia?.type === 'video' ? (
                        <video
                            src={currentMedia.url}
                            className="w-full h-full object-contain"
                            autoPlay
                            muted
                            loop
                            playsInline
                            controls
                        />
                    ) : (
                        <img
                            src={currentMedia?.url || item?.image || ''}
                            className="w-full h-full object-contain bg-gray-100"
                            onError={(e) => { e.currentTarget.src = "https://placehold.co/900x600?text=Item"; }}
                            alt={item?.name || 'Item'}
                        />
                    )}

                    {mediaList.length > 1 && (
                        <>
                            <button
                                type="button"
                                onClick={goPrev}
                                className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/35 hover:bg-black/55 text-white rounded-full p-2 transition backdrop-blur-sm"
                                aria-label="Previous image"
                            >
                                <ChevronLeft size={22} />
                            </button>
                            <button
                                type="button"
                                onClick={goNext}
                                className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/35 hover:bg-black/55 text-white rounded-full p-2 transition backdrop-blur-sm"
                                aria-label="Next image"
                            >
                                <ChevronRight size={22} />
                            </button>
                        </>
                    )}
                </div>

                {mediaList.length > 1 && (
                    <div className="px-5 py-3 border-b border-gray-100">
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {mediaList.map((m, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setMediaIndex(idx)}
                                    className={`shrink-0 w-16 h-12 rounded-lg border overflow-hidden bg-gray-100 flex items-center justify-center ${idx === safeIndex ? 'border-purple-600 ring-2 ring-purple-200' : 'border-gray-200'}`}
                                    aria-label={`Media ${idx + 1}`}
                                >
                                    {m.type === 'video' ? (
                                        <Video className="text-gray-500" size={18} />
                                    ) : (
                                        <img
                                            src={m.url}
                                            className="w-full h-full object-contain"
                                            onError={(e) => { e.currentTarget.src = "https://placehold.co/200x150?text=Item"; }}
                                            alt=""
                                        />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="p-5 overflow-y-auto">
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-2xl font-extrabold text-purple-700">${item.price.toFixed(2)}</div>
                    </div>

                    {item?.description && (
                        <p className="text-gray-600 text-sm mb-4 whitespace-pre-line">{item.description}</p>
                    )}

                    <div className="flex flex-wrap gap-2 mb-6">
                        {displayChars.map((char) => (
                            <span
                                key={char.name}
                                className="px-2.5 py-1 text-[11px] uppercase font-bold text-gray-700 bg-gray-100 rounded-full border border-gray-200"
                            >
                                {char.values.length > 1 ? char.values.join(' | ') : char.values[0]}
                            </span>
                        ))}
                    </div>

                    <button
                        onClick={onAddToCart}
                        className="w-full bg-gray-900 hover:bg-purple-700 text-white font-bold py-3.5 rounded-2xl shadow hover:shadow-lg transition flex justify-center items-center"
                    >
                        <ShoppingCart size={18} className="mr-2" /> Add to {labels.cart}
                    </button>

                    <div className="mt-3 text-xs text-gray-400 text-center">
                        Tip: Use arrows or thumbnails to browse images.
                    </div>
                </div>
            </div>
        </div>
    );
};


// 🟢 NEW COMPONENT: Visual Product Search Experience (The "Wizard")
const VisualProductSearch = ({ items, initialSearchTerm, onClose, onAddToCart }: { items: MenuItem[], initialSearchTerm: string, onClose: () => void, onAddToCart: (item: MenuItem, options: Record<string, string>) => void }) => {
    const [selectedModel, setSelectedModel] = useState<string | null>(null);
    const [selectedGender, setSelectedGender] = useState<string | null>(null);
    const [selectedColorChar, setSelectedColorChar] = useState<{name: string, value: string} | null>(null);
    const [selectedSize, setSelectedSize] = useState<string | null>(null);
    const [mediaIndex, setMediaIndex] = useState(0); 

    // 0. Determine unique Model Names
    const availableModels = useMemo(() => Array.from(new Set(items.map(i => i.name))), [items]);

    // Track whether this isolate flow started with multiple models (so we can offer a true "back to model select")
    const initialModelsCountRef = useRef<number | null>(null);
    useEffect(() => {
        if (initialModelsCountRef.current === null) initialModelsCountRef.current = availableModels.length;

        const startedWithMultipleModels = (initialModelsCountRef.current ?? 0) > 1;

        // If we started with a single model, auto-select it.
        // If we started with multiple models, do not auto-select/reset based on later prop changes.
        if (!startedWithMultipleModels) {
            if (availableModels.length === 1) setSelectedModel(availableModels[0]);
            else setSelectedModel(null);
        } else {
            // Safety: if the currently selected model disappears, clear it.
            if (selectedModel && !availableModels.includes(selectedModel)) setSelectedModel(null);
        }
    }, [availableModels, selectedModel]);

    const hasModelStep = (initialModelsCountRef.current ?? availableModels.length) > 1;

    // Filter items by Model
    const modelFilteredItems = useMemo(() => {
        return selectedModel ? items.filter(i => i.name === selectedModel) : items;
    }, [items, selectedModel]);

    // 1. Determine available Genders/Lead categories
    const leadCharName = useMemo(() => {
        const firstItemChars = modelFilteredItems[0]?.characteristics;
        if (!firstItemChars || firstItemChars.length === 0) return undefined;

        // Prefer the second filtered/category characteristic as the gender/department selector
        const categoryChars = firstItemChars.filter(c => c.isCategory);
        if (categoryChars.length >= 2) {
            return categoryChars[1].name;
        }

        // Otherwise, prefer an explicit lead characteristic if provided
        const byLeadFlag = firstItemChars.find(c => c.isLead);
        if (byLeadFlag) return byLeadFlag.name;

        // Fallback to the first category characteristic if any
        if (categoryChars.length >= 1) {
            return categoryChars[0].name;
        }

        // Final fallback: use the very first characteristic
        return firstItemChars[0].name;
    }, [modelFilteredItems]);
    const availableGenders = useMemo(() => {
        if (!leadCharName) return [];
        const genders = new Set<string>();
        modelFilteredItems.forEach(i => {
            const val = i.characteristics?.find(c => normalize(c.name) === normalize(leadCharName))?.values[0];
            if (val) genders.add(val);
        });
        return Array.from(genders);
    }, [modelFilteredItems, leadCharName]);

    // Auto-select gender if only one exists
    useEffect(() => { if (availableGenders.length === 1) setSelectedGender(availableGenders[0]); }, [availableGenders]);

    // 2. Filter items based on gender selection
    const genderFilteredItems = useMemo(() => {
        if (!selectedModel) return [];
        if (availableGenders.length > 1 && !selectedGender) return [];
        if (!selectedGender) return modelFilteredItems;
        return modelFilteredItems.filter(i => i.characteristics?.find(c => normalize(c.name) === normalize(leadCharName!))?.values[0] === selectedGender);
    }, [modelFilteredItems, selectedGender, availableGenders, leadCharName, selectedModel]);

    // 3. Determine Visual Variants (Colors/Patterns)
    const visualVariants = useMemo(() => {
        const variants: Map<string, { charName: string, value: string, image: string, item: MenuItem }> = new Map();
        genderFilteredItems.forEach(item => {
            // Find first characteristic that defines visual appearance
            const visualChar = item.characteristics?.find(c => VISUAL_VARIANT_ATTRIBUTES.includes(normalize(c.name)));
            if (visualChar && visualChar.values.length > 0) {
                const val = visualChar.values[0];
                const key = `${normalize(visualChar.name)}_${normalize(val)}`;
                if (!variants.has(key)) {
                    // Try to find a valid image in media or item.image
                    const img = (item.media && item.media.length > 0) ? item.media[0].url : item.image;
                    variants.set(key, { charName: visualChar.name, value: val, image: img, item: item });
                }
            }
        });
        return Array.from(variants.values());
    }, [genderFilteredItems]);

    // 4. Get the currently selected item based on color (for media display)
    const activeVisualItem = useMemo(() => {
        if (!selectedColorChar) return null;
        return visualVariants.find(v => v.charName === selectedColorChar.name && v.value === selectedColorChar.value)?.item;
    }, [selectedColorChar, visualVariants]);

    const activeGender = useMemo(() => {
        if (!activeVisualItem || !leadCharName) return null;
        const genderVal = activeVisualItem.characteristics
            ?.find(c => normalize(c.name) === normalize(leadCharName))
            ?.values?.[0];
        return genderVal || null;
    }, [activeVisualItem, leadCharName]);


    // 5. Determine available Sizes based on Color selection
    const availableSizes = useMemo(() => {
        if (!selectedColorChar) return [];
        const sizes: Set<string> = new Set();
        const colorMatchedItems = genderFilteredItems.filter(i => 
            i.characteristics?.find(c => c.name === selectedColorChar.name && c.values[0] === selectedColorChar.value)
        );
        colorMatchedItems.forEach(item => {
            const sizeChar = item.characteristics?.find(c => normalize(c.name) === 'size');
            if (sizeChar && sizeChar.values.length > 0) sizes.add(sizeChar.values[0]);
        });
        return Array.from(sizes).sort((a, b) => {
            const numA = parseFloat(a.replace(/[^0-9.]/g, ''));
            const numB = parseFloat(b.replace(/[^0-9.]/g, ''));
            return (isNaN(numA) || isNaN(numB)) ? a.localeCompare(b) : numA - numB;
        });
    }, [genderFilteredItems, selectedColorChar]);

    // Reset selects when parents change
    useEffect(() => { setSelectedColorChar(null); setSelectedSize(null); }, [selectedGender, selectedModel]);
    useEffect(() => { setSelectedSize(null); setMediaIndex(0); }, [selectedColorChar]);

    const handleFinalAddToCart = () => {
        if (!selectedModel || (!selectedGender && availableGenders.length > 1) || !selectedColorChar || !selectedSize) return;

        const finalItem = items.find(i => {
            const matchesModel = i.name === selectedModel;
            const matchesGender = !selectedGender || i.characteristics?.find(c => normalize(c.name) === normalize(leadCharName!))?.values[0] === selectedGender;
            const matchesColor = i.characteristics?.find(c => c.name === selectedColorChar.name)?.values[0] === selectedColorChar.value;
            const matchesSize = i.characteristics?.find(c => normalize(c.name) === 'size')?.values[0] === selectedSize;
            return matchesModel && matchesGender && matchesColor && matchesSize;
        });

        if (finalItem) {
            const options: Record<string, string> = {};
            if (selectedGender && leadCharName) options[leadCharName] = selectedGender;
            options[selectedColorChar.name] = selectedColorChar.value;
            options['Size'] = selectedSize;
            onAddToCart(finalItem, options);
            onClose(); 
        } else {
            alert("Sorry, that specific combination seems to be unavailable right now.");
        }
    };

    // Media Carousel Logic
    const mediaList = activeVisualItem && activeVisualItem.media && activeVisualItem.media.length > 0 ? activeVisualItem.media : (activeVisualItem ? [{ type: 'image' as const, url: activeVisualItem.image }] : []);
    const currentMedia = mediaList[mediaIndex];
    const nextSlide = () => setMediaIndex((prev) => (prev + 1) % mediaList.length);
    const prevSlide = () => setMediaIndex((prev) => (prev - 1 + mediaList.length) % mediaList.length);

    const canGoBack = Boolean(
        selectedColorChar ||
        (availableGenders.length > 1 && selectedGender) ||
        (hasModelStep && selectedModel)
    );

    const handleBack = () => {
        // Go back one step in the isolate selection flow
        if (selectedColorChar) {
            setSelectedColorChar(null);
            setSelectedSize(null);
            setMediaIndex(0);
            return;
        }
        if (availableGenders.length > 1 && selectedGender) {
            setSelectedGender(null);
            setSelectedColorChar(null);
            setSelectedSize(null);
            setMediaIndex(0);
            return;
        }
        if (hasModelStep && selectedModel) {
            setSelectedModel(null);
            setSelectedGender(null);
            setSelectedColorChar(null);
            setSelectedSize(null);
            setMediaIndex(0);
            return;
        }
    };

    return (
        <div className="fixed inset-0 bg-white z-50 overflow-y-auto animate-fade-in">
            <div className="sticky top-0 bg-white shadow-sm p-4 flex justify-between items-center z-20">
                <div className="flex items-center gap-3">
                    {canGoBack && (
                        <button
                            onClick={handleBack}
                            className="inline-flex items-center gap-2 bg-purple-600 text-white hover:bg-purple-700 px-4 py-2 rounded-full shadow-sm transition"
                        >
                            <ChevronLeft size={18} /> Back
                        </button>
                    )}
                    <div>
                        <h2 className="text-2xl font-extrabold font-serif truncate">{selectedModel || `Search: "${initialSearchTerm}"`}</h2>
                        {hasModelStep && !selectedModel && <p className="text-sm text-gray-500">Multiple products found. Select one below.</p>}
                    </div>
                </div>
                {/* 🟢 RED CLOSE BUTTON */}
                <button onClick={onClose} className="text-white bg-red-500 hover:bg-red-600 rounded-full p-2 shadow-md transition"><X size={24}/></button>
            </div>

            <div className="max-w-4xl mx-auto p-4 md:p-8 pb-32">
                
                {/* STEP 0: MODEL SELECT (If multiple models match search) */}
                {hasModelStep && !selectedModel && (
                    <div className="mb-8">
                        <h3 className="text-lg font-bold mb-3 text-gray-800">Select Model</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {availableModels.map(m => {
                                const repItem = items.find(i => i.name === m);
                                return (
                                    <button key={m} onClick={() => setSelectedModel(m)} className="flex items-center p-4 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 transition text-left">
                                        <img src={repItem?.image} className="w-16 h-16 object-cover rounded-lg mr-4" />
                                        <span className="font-bold text-lg">{m}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* STEP 1: GENDER SELECT */}
                {selectedModel && availableGenders.length > 1 && (
                    <div className="mb-8">
                        <h3 className="text-lg font-bold mb-3 text-gray-800">Select {toTitleCase(leadCharName || 'Department')}</h3>
                        <div className="flex gap-3">
                            {availableGenders.map(g => (
                                <button key={g} onClick={() => setSelectedGender(g)} className={`px-6 py-3 rounded-full font-bold text-lg transition ${selectedGender === g ? 'bg-black text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{g}</button>
                            ))}
                        </div>
                    </div>
                )}

                {/* STEP 2: VISUAL VARIANT SELECT */}
                {selectedModel && (selectedGender || availableGenders.length <= 1) && (
                    <div className="mb-8 animate-fade-in">
                        <h3 className="text-lg font-bold mb-3 text-gray-800">Select Style / Color</h3>
                        {visualVariants.length === 0 ? <p className="text-gray-400">No variants found.</p> : (
                            <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                                {visualVariants.map((v, idx) => (
                                    <button key={idx} onClick={() => setSelectedColorChar({name: v.charName, value: v.value})} className={`relative rounded-xl overflow-hidden aspect-square border-2 transition group ${selectedColorChar?.value === v.value ? 'border-purple-600 ring-2 ring-purple-200 ring-offset-2' : 'border-transparent hover:border-gray-300'}`}>
                                        <img src={v.image} className="w-full h-full object-cover" alt={v.value} onError={(e)=>{e.currentTarget.src="https://placehold.co/200"}} />
                                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs font-bold p-2 text-center truncate">{v.value}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* STEP 3: IMMERSIVE MEDIA & SIZE SELECT */}
                {selectedColorChar && activeVisualItem && (
                    <div className="animate-fade-in space-y-8">
                        {/* 🟢 Large Immersive Media Carousel */}
                        <div className="relative h-96 md:h-[500px] bg-gray-100 rounded-2xl overflow-hidden shadow-xl">
                             {currentMedia && (currentMedia.type === 'video' ? ( <video src={currentMedia.url} className="w-full h-full object-cover" autoPlay muted loop playsInline /> ) : ( <img src={currentMedia.url} className="w-full h-full object-cover" alt="Selected Variant" /> ))}
                             {mediaList.length > 1 && ( <>
                                <button onClick={prevSlide} className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white text-black rounded-full p-3 transition shadow-lg"><ChevronLeft size={24} /></button>
                                <button onClick={nextSlide} className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white text-black rounded-full p-3 transition shadow-lg"><ChevronRight size={24} /></button>
                                <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">{mediaList.map((_, idx) => (<div key={idx} className={`w-2 h-2 rounded-full shadow-sm transition-colors ${idx === mediaIndex ? 'bg-white' : 'bg-white/50'}`}/>))}</div>
                            </> )}
                        </div>
                        
                        {/* Size Selection */}
                        <div>
                            <h3 className="text-lg font-bold mb-3 text-gray-800 flex justify-between">Select Size <span className="text-purple-600">${activeVisualItem.price.toFixed(2)}</span></h3>
                            {activeGender && (
                                <p className="text-sm text-gray-500 mb-2">{activeGender}</p>
                            )}
                            {availableSizes.length === 0 ? ( <p className="text-red-500 font-bold">Out of Stock in this style.</p> ) : (
                                <div className="flex flex-wrap gap-3">
                                    {availableSizes.map(size => {
                                        // Find exact item to check stock
                                        const exactItem = items.find(i => i.name === selectedModel && i.characteristics?.find(c => c.name === selectedColorChar.name)?.values[0] === selectedColorChar.value && i.characteristics?.find(c => normalize(c.name) === 'size')?.values[0] === size);
                                        const isOutOfStock = exactItem && exactItem.trackStock && exactItem.stock <= 0;
                                        return (
                                            <button key={size} disabled={isOutOfStock} onClick={() => setSelectedSize(size)} className={`min-w-[60px] px-4 py-3 rounded-lg font-bold border text-center transition relative ${isOutOfStock ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : selectedSize === size ? 'bg-purple-600 text-white border-purple-600 shadow-md' : 'bg-white text-gray-800 border-gray-300 hover:border-purple-400'}`}>
                                                {size} {isOutOfStock && <span className="absolute -top-2 -right-2 bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded-full">Sold Out</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="text-gray-500 text-sm bg-gray-50 p-4 rounded-xl">{activeVisualItem.description}</div>
                    </div>
                )}
            </div>

            {/* STEP 4: FIXED ADD TO CART BAR */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] md:pl-[180px]">
                <div className="max-w-4xl mx-auto">
                    <button 
                        onClick={handleFinalAddToCart} 
                        disabled={!selectedColorChar || !selectedSize} 
                        className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-black transition disabled:bg-gray-300 disabled:text-gray-500 text-lg flex items-center justify-center"
                    >
                        <ShoppingCart className="mr-2"/> 
                        {!selectedColorChar ? "Select Color above" : !selectedSize ? "Select Size above" : "Add to Cart"}
                    </button>
                </div>
            </div>
        </div>
    );
};

// 🟢 SMART HIERARCHICAL MENU
const SmartCategoryMenu = ({ items, activeFilters, onApplyFilter, onItemClick }: { items: MenuItem[], activeFilters: Record<string, string>, onApplyFilter: (cat: string, val: string) => void, onItemClick: (item: MenuItem) => void }) => {
    
    const getNextCategory = (subset: MenuItem[], ignoredCats: string[], isRoot: boolean = false) => {
        let bestCat = null;
        let minIndex = Infinity;

        subset.forEach(item => {
            if (item.trackStock && item.stock <= 0) return;
            item.characteristics?.forEach((char, idx) => {
                const normName = normalize(char.name);
                if (isRoot && idx !== 0) return;
                if (char.isCategory && !ignoredCats.includes(normName) && !activeFilters[char.name]) {
                    if (idx < minIndex) {
                        minIndex = idx;
                        bestCat = char.name; 
                    }
                }
            });
        });

        return bestCat;
    };

    const rootCategory = getNextCategory(items, [], true); 

    const CategoryValuesMenu = ({ category, filterState }: { category: string, filterState: Record<string,string> }) => {
        const [activeSubItem, setActiveSubItem] = useState<string | null>(null); 
        
        
        const [openLeftFor, setOpenLeftFor] = useState<Record<string, boolean>>({});
        const matchingItems = items.filter(i => 
            Object.entries(filterState).every(([c,v]) => 
                i.characteristics?.find(char => normalize(char.name) === normalize(c))?.values.some(val => normalize(val) === normalize(v))
            )
        );

        const rawValues = matchingItems.flatMap(i => i.characteristics?.find(c => normalize(c.name) === normalize(category))?.values || []);
        const uniqueValues = Array.from(new Set(rawValues.map(v => normalize(v))));

        return (
            <div className="bg-white rounded-xl shadow-2xl border border-gray-200 py-2 min-w-[200px]">
                {uniqueValues.map(normVal => {
                    const originalVal = rawValues.find(v => normalize(v) === normVal) || normVal;
                    const displayVal = capitalize(normVal);

                    const nextState = { ...filterState, [category]: normVal }; 
                    const nextSubset = items.filter(i => 
                        Object.entries(nextState).every(([c,v]) => 
                            i.characteristics?.find(char => normalize(char.name) === normalize(c))?.values.some(itemVal => normalize(itemVal) === normalize(v))
                        )
                    );
                    
                    const nextCat = getNextCategory(nextSubset, Object.keys(nextState).map(k => normalize(k)));

                    return (
                        <div 
                            key={normVal} 
                            className="relative"
                            onMouseEnter={(e) => {
                                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                const estimatedFlyoutWidth = 220;
                                const shouldOpenLeft = rect.right + estimatedFlyoutWidth > window.innerWidth - 8;
                                setOpenLeftFor((prev) => ({ ...prev, [normVal]: shouldOpenLeft }));
                                setActiveSubItem(normVal);
                            }}
                            onMouseLeave={() => setActiveSubItem(null)} 
                        >
                            <button 
                                onClick={() => { if (!nextCat) onApplyFilter(category, displayVal); }} 
                                className="w-full text-left px-4 py-3 hover:bg-purple-50 flex justify-between items-center text-sm font-bold text-gray-700 hover:text-purple-700 transition"
                            >
                                {displayVal} 
                                {(nextCat || nextSubset.length > 0) && <ChevronRight size={14} className="text-gray-400"/>}
                            </button>
                            
                            {activeSubItem === normVal && (
                                <div className={`absolute top-0 ${openLeftFor[normVal] ? 'right-full pr-2' : 'left-full pl-2'} z-50 animate-fade-in`}>
                                    {nextCat ? (
                                        <CategoryValuesMenu category={nextCat} filterState={nextState} />
                                    ) : (
                                        <div className="bg-white rounded-xl shadow-2xl border border-gray-200 py-2 min-w-[200px]">
                                            {nextSubset.map(product => (
                                                <button 
                                                    key={product.id || product.name}
                                                    onClick={() => onItemClick(product)} 
                                                    className="w-full text-left px-4 py-2 hover:bg-green-50 flex justify-between items-center text-sm text-gray-700 hover:text-green-700 transition group/product"
                                                >
                                                    <span>{product.name}</span>
                                                    <span className="text-xs font-bold text-gray-400 group-hover/product:text-green-600">${product.price.toFixed(2)}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    if (!rootCategory) return null;

    // 📱 Mobile drawer state (used below md breakpoint)
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [mobileCategory, setMobileCategory] = useState<string | null>(rootCategory);
    const [mobileFilterState, setMobileFilterState] = useState<Record<string, string>>({});
    const [mobileStack, setMobileStack] = useState<Array<{ category: string; filterState: Record<string, string> }>>([]);

    const getMatchingItemsForState = (state: Record<string, string>) => {
        return items.filter(i =>
            Object.entries(state).every(([c, v]) =>
                i.characteristics?.find(char => normalize(char.name) === normalize(c))?.values.some(val => normalize(val) === normalize(v))
            )
        );
    };

    const openMobileDrawer = () => {
        setIsMobileOpen(true);
        setMobileCategory(rootCategory);
        setMobileFilterState({});
        setMobileStack([]);
    };

    const closeMobileDrawer = () => setIsMobileOpen(false);

    const handleMobileBack = () => {
        setMobileStack(prev => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            setMobileCategory(last.category);
            setMobileFilterState(last.filterState);
            return prev.slice(0, -1);
        });
    };

    const handleMobilePickValue = (normVal: string) => {
        if (!mobileCategory) return;

        const nextState = { ...mobileFilterState, [mobileCategory]: normVal };
        const nextSubset = getMatchingItemsForState(nextState);
        const nextCat = getNextCategory(nextSubset, Object.keys(nextState).map(k => normalize(k)));

        setMobileStack(prev => [...prev, { category: mobileCategory, filterState: mobileFilterState }]);
        setMobileFilterState(nextState);
        setMobileCategory(nextCat);
    };

    const renderMobileDrawerBody = () => {
        // If we still have a category to pick, show values for it
        if (mobileCategory) {
            const matchingItems = getMatchingItemsForState(mobileFilterState);
            const rawValues = matchingItems.flatMap(i => i.characteristics?.find(c => normalize(c.name) === normalize(mobileCategory))?.values || []);
            const uniqueValues = Array.from(new Set(rawValues.map(v => normalize(v))));

            return (
                <div className="flex-1 overflow-y-auto px-4 pb-6">
                    <div className="text-sm font-extrabold text-gray-900 mb-3">
                        Select {mobileCategory}
                    </div>

                    {uniqueValues.length === 0 ? (
                        <div className="text-sm text-gray-500">No options found.</div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {uniqueValues.map(normVal => {
                                const displayVal = capitalize(normVal);
                                return (
                                    <button
                                        key={normVal}
                                        onClick={() => handleMobilePickValue(normVal)}
                                        className="w-full text-left px-4 py-4 rounded-xl border border-gray-200 bg-white shadow-sm hover:bg-purple-50 hover:border-purple-200 transition flex items-center justify-between min-w-0"
                                    >
                                        <span className="font-bold text-gray-800">{displayVal}</span>
                                        <ChevronRight size={16} className="text-gray-400" />
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        }

        // Leaf: show matching products list
        const leafItems = getMatchingItemsForState(mobileFilterState);

        return (
            <div className="flex-1 overflow-y-auto px-4 pb-6">
                <div className="text-sm font-extrabold text-gray-900 mb-3">Select Item</div>
                {leafItems.length === 0 ? (
                    <div className="text-sm text-gray-500">No items found.</div>
                ) : (
                    <div className="grid grid-cols-1 gap-2">
                        {leafItems.map(product => (
                            <button
                                key={product.id || product.name}
                                onClick={() => {
                                    onItemClick(product);
                                    closeMobileDrawer();
                                }}
                                className="w-full text-left px-4 py-4 rounded-xl border border-gray-200 bg-white shadow-sm hover:bg-green-50 hover:border-green-200 transition flex items-center justify-between"
                            >
                                <span className="font-bold text-gray-800">{product.name}</span>
                                <span className="text-sm font-extrabold text-purple-700">${product.price.toFixed(2)}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const selectedCrumbs = Object.entries(mobileFilterState).map(([cat, val]) => ({
        cat,
        val: capitalize(val),
    }));

    return (
        <>
            {/* 📱 Mobile: drawer-based Browse Menu */}
            <div className="relative md:hidden inline-block">
                <button
                    onClick={openMobileDrawer}
                    className="flex items-center bg-gray-900 text-white px-5 py-3 rounded-full font-bold shadow-lg hover:bg-black transition"
                >
                    <Filter className="mr-2" size={18} /> Browse Menu <ChevronDown className="ml-2" size={16} />
                </button>

                {isMobileOpen && (
                    <div className="fixed inset-0 z-[999]">
                        {/* overlay */}
                        <div
                            className="absolute inset-0 bg-black/40"
                            onClick={closeMobileDrawer}
                        />
                        {/* sheet */}
                        <div className="absolute inset-x-0 bottom-0 top-0 bg-white flex flex-col">
                            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                    {mobileStack.length > 0 && (
                                        <button
                                            onClick={handleMobileBack}
                                            className="flex items-center gap-1 px-3 py-2 rounded-full bg-purple-700 text-white font-bold text-sm shadow hover:bg-purple-800 transition"
                                        >
                                            <ChevronLeft size={16} /> Back
                                        </button>
                                    )}
                                    <div className="text-base font-extrabold text-gray-900">Refine</div>
                                </div>

                                <button
                                    onClick={closeMobileDrawer}
                                    className="w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center shadow hover:bg-red-600 transition"
                                    aria-label="Close"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {selectedCrumbs.length > 0 && (
                                <div className="px-4 py-3 border-b border-gray-100">
                                    <div className="flex flex-wrap gap-2">
                                        {selectedCrumbs.map(c => (
                                            <span
                                                key={c.cat}
                                                className="px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-xs font-bold"
                                            >
                                                {c.val}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {renderMobileDrawerBody()}
                        </div>
                    </div>
                )}
            </div>

            {/* 🖥️ Desktop/Tablet: hover flyout Browse Menu */}
            <div className="relative group hidden md:inline-block">
                <button className="flex items-center bg-gray-900 text-white px-6 py-3 rounded-full font-bold shadow-lg hover:bg-black transition">
                    <Filter className="mr-2" size={18}/> Browse Menu <ChevronDown className="ml-2" size={16}/>
                </button>
                <div className="absolute top-full left-0 pt-2 z-50 animate-fade-in hidden group-hover:block max-w-[calc(100vw-2rem)]">
                    <CategoryValuesMenu category={rootCategory} filterState={{}} />
                </div>
            </div>
        </>
    );
};

// ====================================================================================
// 4. MAIN APP LOGIC
// ====================================================================================
function AppContent() {

    // Ensure the page background covers any horizontal overflow (prevents mismatched "brown" area on wide layouts)
    useEffect(() => {
        try {
            const bg = '#f3f4f6'; // Tailwind gray-100
            document.documentElement.style.backgroundColor = bg;
            document.body.style.backgroundColor = bg;
        } catch {}
    }, []);
    const [activeSection, setActiveSection] = useState('home');
    const [cartItems, setCartItems] = useState<CartItem[]>([]);
    const [db, setDb] = useState<any>(null); const [auth, setAuth] = useState<any>(null); const [functions, setFunctions] = useState<any>(null); const [userId, setUserId] = useState<string|null>(null); const [isOwner, setIsOwner] = useState(false); 
    const [orders, setOrders] = useState<Order[]>([]); const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
    const [orderStatus, setOrderStatus] = useState<string|null>(null);
    const [isAppReady, setIsAppReady] = useState(false); const [isCleaningHistory, setIsCleaningHistory] = useState(false);
    const [paymentIntentClientSecret, setPaymentIntentClientSecret] = useState<string|null>(null);
    const [paymentIntentAmount, setPaymentIntentAmount] = useState<number|null>(null);
    const [stripeRefreshKey, setStripeRefreshKey] = useState(0); const isFetchingPayment = useRef(false);
    
    // 🟢 LOAD STATE
    const [menuItems, setMenuItems] = useState<MenuItem[]>(DEFAULT_MENU_ITEMS);

    // Global low-stock threshold (applies to all stock-tracked items). Set in Dashboard > Stock.
    const [globalLowStockThreshold, setGlobalLowStockThreshold] = useState<number>(() => {
        try {
            const raw = localStorage.getItem('globalLowStockThreshold');
            const parsed = raw !== null ? parseInt(raw, 10) : NaN;
            return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
        } catch {
            return 5;
        }
    });
    useEffect(() => {
        try {
            localStorage.setItem('globalLowStockThreshold', String(globalLowStockThreshold));
        } catch {
            // ignore
        }
    }, [globalLowStockThreshold]);


    const isLowStockItem = useCallback((item: MenuItem): boolean => {
        if (!item.trackStock) return false;
        const stock = typeof item.stock === 'number' ? item.stock : 0;

        // Always treat out-of-stock as a "low" condition for dashboard visibility.
        if (stock <= 0) return true;

        const threshold = globalLowStockThreshold;
        if (!threshold || threshold <= 0) return false;

        return stock <= threshold;
    }, [globalLowStockThreshold]);


    const [isMenuLoading, setIsMenuLoading] = useState(true);

    const [dashboardTab, setDashboardTab] = useState<'orders'|'menu'|'stock'|'history'>('orders');
    const [newItem, setNewItem] = useState<{
        name:string, description:string, price:string, image:string, stock:string, trackStock:boolean, 
        characteristics: Characteristic[], media: MediaItem[]
    }>({ 
        name: '', description: '', price: '', image: '', stock: '10', trackStock: STORE_CONFIG.type === 'retail', 
        characteristics: [], media: []
    });
    
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [showNewProductForm, setShowNewProductForm] = useState(false);
    const [characteristicTemplate, setCharacteristicTemplate] = useState<Characteristic[] | null>(null);

    const [dashboardMenuItems, setDashboardMenuItems] = useState<MenuItem[]>([]);
    useEffect(() => {
        // 🟢 Initialize characteristic template from the first existing item (if any)
        if (characteristicTemplate === null && dashboardMenuItems.length > 0) {
            const template = (dashboardMenuItems[0].characteristics || []).map(c => ({ ...c, values: [] }));
            if (template.length > 0) setCharacteristicTemplate(template);
        }
    }, [dashboardMenuItems, characteristicTemplate]);

    const [isAddingItem, setIsAddingItem] = useState(false); const [isSaving, setIsSaving] = useState(false);
    const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const hasCheckedSeed = useRef(false);
    const [customerInfo, setCustomerInfo] = useState({ name: '', email: '', phone: '', instructions: '', street: '', city: '', zip: '' });
    const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
    const [openFilterDropdown, setOpenFilterDropdown] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState(''); // 🟢 SEARCH STATE
    const [catalogIsolateItems, setCatalogIsolateItems] = useState<MenuItem[] | null>(null);
    const [catalogIsolateTerm, setCatalogIsolateTerm] = useState('');
    const [catalogPreviewGroup, setCatalogPreviewGroup] = useState<CatalogGroup | null>(null);
    
    // 🟢 ISOLATED ITEM STATE
    const [isolatedItem, setIsolatedItem] = useState<MenuItem | null>(null);
    const [selectedItemForVariant, setSelectedItemForVariant] = useState<MenuItem | null>(null);
    const [currentVariantSelections, setCurrentVariantSelections] = useState<Record<string, string>>({});
    const [activeValueDropdown, setActiveValueDropdown] = useState<number | null>(null);
    const [aiStoreType, setAiStoreType] = useState('');
    const [showAiModal, setShowAiModal] = useState(false);
    const [draggedCharIndex, setDraggedCharIndex] = useState<number | null>(null); // 🟢 DRAG STATE
    
    // 🟢 TYPO CORRECTION STATE
    const [typoSuggestions, setTypoSuggestions] = useState<{index: number, suggestion: string} | null>(null);
    
    // 🟢 MEDIA UPLOAD STATE
    const [mediaInputType, setMediaInputType] = useState<'url' | 'file'>('url');
    const [mediaInputValue, setMediaInputValue] = useState('');

    // 🟢 CLICK OUTSIDE HANDLER (FOR DASHBOARD DROPDOWNS)
    const dropdownRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setActiveValueDropdown(null);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const labels = STORE_CONFIG.content[STORE_CONFIG.type];
    const BrandIcon = labels.iconBrand;
    const CatalogIcon = labels.iconMenu;
    const FulfillmentIcon = labels.iconFulfill;

    const calculateTotal = useCallback(() => cartItems.reduce((t, i) => t + (i.price * i.quantity), 0), [cartItems]);

    // 🟢 1. MEMOIZE KNOWN ATTRIBUTES (LEARNING LOGIC + LEAD DETECTION)
    const knownAttributes = useMemo(() => {
        const map: Record<string, {isCategory: boolean, isLead: boolean, values: Set<string>}> = {};
        menuItems.forEach(item => {
            item.characteristics?.forEach(c => {
                const key = normalize(c.name);
                if (!map[key]) map[key] = { isCategory: false, isLead: false, values: new Set() };
                if (c.isCategory) map[key].isCategory = true;
                if (c.isLead) map[key].isLead = true;
                c.values.forEach(v => map[key].values.add(v));
            });
        });
        return map;
    }, [menuItems]);
    
    // 🟢 HELPER: FIND GLOBAL LEAD
    const globalLeadCategory = useMemo(() => {
        return Object.keys(knownAttributes).find(k => knownAttributes[k].isLead);
    }, [knownAttributes]);

    useEffect(() => { if(orderStatus) { const t = setTimeout(()=>setOrderStatus(null), 5000); return ()=>clearTimeout(t); } }, [orderStatus]);

    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig); setDb(getFirestore(app)); setFunctions(getFunctions(app)); const fbAuth = getAuth(app); setAuth(fbAuth);
            onAuthStateChanged(fbAuth, async (u) => { if(!u) { await signInAnonymously(fbAuth); } else { setUserId(u.uid); setIsOwner(!u.isAnonymous); setIsAppReady(true); } });
        } catch(e) { console.error(e); setUserId('guest'); setIsAppReady(true); }
    }, []);

    useEffect(() => {
        if(!db || !appId) return;
        const unsubMenu = onSnapshot(query(collection(db, `artifacts/${appId}/public/data/menu`)), s => {
            if(!s.empty) { 
                const m = s.docs.map(d => ({id:d.id, ...d.data()}) as MenuItem);
                const normalized = m.map(it => {
                    if (it.trackStock) {
                        const n = Number((it as any).stock ?? 0);
                        return { ...it, stock: Number.isFinite(n) ? Math.max(0, n) : 0 } as MenuItem;
                    }
                    return it;
                });
                setMenuItems(normalized); 
                
                const backup = localStorage.getItem(`saffron_drafts_v1_${appId}`);
                if (backup) {
                    try {
                        const localData = JSON.parse(backup);
                        if (Array.isArray(localData) && localData.length > 0) {
                            setDashboardMenuItems(localData);
                            setHasUnsavedChanges(true); 
                        } else {
                            setDashboardMenuItems(m);
                        }
                    } catch(e) { setDashboardMenuItems(m); }
                } else {
                     setDashboardMenuItems(m);
                }
            }
            else { 
                setMenuItems([]); 
                const backup = localStorage.getItem(`saffron_drafts_v1_${appId}`);
                if (backup) {
                    try { setDashboardMenuItems(JSON.parse(backup)); setHasUnsavedChanges(true); } catch(e) {}
                }
            }
            setIsMenuLoading(false);
        });
        return () => unsubMenu();
    }, [db, appId]);

    // 🟢 LOCAL BACKUP TRIGGER
    useEffect(() => {
        if (hasUnsavedChanges) {
            localStorage.setItem(`saffron_drafts_v1_${appId}`, JSON.stringify(dashboardMenuItems));
        }
    }, [dashboardMenuItems, hasUnsavedChanges, appId]);

    const sanitizeOrder = (data: any, id: string): Order => ({
        id, userId: data?.userId||'guest', customerName: data?.customerName||'Unknown', customerPhone: data?.customerPhone||'', customerEmail: data?.customerEmail||'',
        fulfillment: data?.fulfillment || null, deliveryInstructions: data?.deliveryInstructions || null, 
        items: Array.isArray(data?.items) ? data.items : [], 
        totalAmount: data?.totalAmount||0, status: data?.status||'Pending',
        payment: data?.payment||{}, timestamp: data?.timestamp, archivedAt: data?.archivedAt
    });

    useEffect(() => {
        if(!db || !isOwner || !appId) return;
        const unsubOrders = onSnapshot(query(collection(db, `artifacts/${appId}/public/data/orders`)), s => {
            setOrders(s.docs.map(d => sanitizeOrder(d.data(), d.id)).sort((a,b)=>(b.timestamp?.seconds||0)-(a.timestamp?.seconds||0)));
        });
        const unsubHistory = onSnapshot(query(collection(db, `artifacts/${appId}/public/data/order_history`)), s => {
            setHistoryOrders(s.docs.map(d => sanitizeOrder(d.data(), d.id)).sort((a,b)=>(b.timestamp?.seconds||0)-(a.timestamp?.seconds||0)));
        });
        return () => { unsubOrders(); unsubHistory(); };
    }, [db, isOwner, appId]);

    useEffect(() => {
        if(activeSection !== 'checkout' || cartItems.length === 0 || !functions) return;
        const amt = Math.round(calculateTotal() * 100);
        if(amt <= 0 || (paymentIntentAmount === amt && paymentIntentClientSecret)) return;
        if(isFetchingPayment.current) return;
        const init = async () => {
            isFetchingPayment.current = true;
            try {
                const res: any = await httpsCallable(functions, 'createPaymentIntent')({ amount: amt, currency: 'usd' });
                setPaymentIntentClientSecret(res.data.clientSecret);
                setPaymentIntentAmount(amt);
                setStripeRefreshKey(p => p + 1);
            } catch(e) { console.error(e); setOrderStatus("Payment connection failed."); } finally { isFetchingPayment.current = false; }
        };
        init();
    }, [activeSection, cartItems, functions, calculateTotal]);

    // 🟢 ADD TO CART FIXED: Ensure image and qty=1
    const addToCart = (item: MenuItem, options: Record<string, string> | null) => {
        setCartItems(prev => {
            // Stock enforcement: never allow adding an item that is out of stock (stock <= 0)
            // We use the latest menuItems snapshot when available, otherwise fall back to the item itself.
            if (item.trackStock) {
                const latest = item.id ? menuItems.find(m => m.id === item.id) : null;
                const currentStock = Number(latest?.stock ?? item.stock ?? 0);
                if (!Number.isFinite(currentStock) || currentStock <= 0) {
                    setOrderStatus('Out of stock.');
                    return prev;
                }
            }

            const optionsStr = JSON.stringify(options || {});

            const existingIndex = prev.findIndex(cartItem => {
                const cartOptionsStr = JSON.stringify(cartItem.selectedOptions || {});

                // Prefer matching by id when both items have one
                if (cartItem.id && item.id && cartItem.id === item.id) {
                    return cartOptionsStr === optionsStr;
                }

                // Fallback for items without ids: match by name + image + options
                if (!cartItem.id && !item.id) {
                    const baseImage = item.image || (item.media && item.media[0]?.url) || '';
                    const cartImage = cartItem.image || (cartItem.media && cartItem.media[0]?.url) || '';
                    return (
                        cartItem.name === item.name &&
                        cartImage === baseImage &&
                        cartOptionsStr === optionsStr
                    );
                }

                // Different ids (or only one has id): treat as different items
                return false;
            });

            const itemImage =
                item.image ||
                (item.media && item.media[0]?.url) ||
                `https://placehold.co/100x100?text=${item.name}`;

            if (existingIndex > -1) {
                const newCart = [...prev];
                const existing = newCart[existingIndex];

                // Enforce stock limit when incrementing an existing cart line
                if (item.trackStock) {
                    const latest = item.id ? menuItems.find(m => m.id === item.id) : null;
                    const currentStock = Number(latest?.stock ?? item.stock ?? 0);
                    const safeStock = Number.isFinite(currentStock) ? Math.max(0, currentStock) : 0;

                    if (safeStock <= 0) {
                        setOrderStatus('Out of stock.');
                        return prev;
                    }

                    const desired = (existing.quantity || 0) + 1;
                    if (desired > safeStock) {
                        setOrderStatus(`Only ${safeStock} left in stock.`);
                        return prev;
                    }
                }

                newCart[existingIndex] = {
                    ...existing,
                    quantity: (existing.quantity || 0) + 1,
                };

                return newCart;
            }

            return [
                ...prev,
                {
                    ...item,
                    image: itemImage,
                    quantity: 1,
                    selectedOptions: options || undefined,
                },
            ];
        });
        setIsolatedItem(null);
        setSelectedItemForVariant(null);
        setCurrentVariantSelections({});
    };

    const handleItemClick = (item: MenuItem) => {
        const selectables = item.characteristics?.filter(c => c.values.length > 1) || [];
        if (selectables.length > 0) {
            const defaults: any = {}; selectables.forEach(c => defaults[c.name] = c.values[0]);
            setCurrentVariantSelections(defaults); setSelectedItemForVariant(item);
        } else { addToCart(item, null); }
    };

    // 🟢 ISOLATE ITEM (Do NOT Add to Cart yet)
    const handleSmartMenuClick = (item: MenuItem) => {
        setIsolatedItem(item); 
    };

    // 🟢 AI SETUP HANDLER (Fixed with Fallback)
    const handleAiStoreSetup = async () => {
        if (!aiStoreType) return;
        setAiLoading(true);
        
        let chars: Characteristic[] = [];

        if (apiKey) {
            const prompt = `Generate a JSON array of 3 characteristic objects for a "${aiStoreType}". Each object has: "name" (string), "values" (array of strings), "isCategory" (boolean), "isLead" (boolean, true ONLY for the main category).`;
            try {
                const res = await callGemini(prompt);
                const jsonStart = res.indexOf('[');
                const jsonEnd = res.lastIndexOf(']') + 1;
                if (jsonStart !== -1 && jsonEnd !== 0) {
                    const jsonStr = res.substring(jsonStart, jsonEnd);
                    chars = JSON.parse(jsonStr);
                }
            } catch (e) {
                console.error("AI connection failed, using offline mode", e);
            }
        }

        if (chars.length === 0) {
            const type = normalize(aiStoreType);
            if (type.includes('shoe') || type.includes('footwear')) {
                chars = [
                    { name: 'Department', values: ['Men', 'Women', 'Kids'], isCategory: true, isLead: true },
                    { name: 'Brand', values: ['Nike', 'Adidas', 'Puma'], isCategory: true, isLead: false },
                    { name: 'Size', values: ['US 7', 'US 8', 'US 9', 'US 10'], isCategory: true, isLead: false },
                    { name: 'Color', values: ['Black', 'White', 'Red', 'Blue'], isCategory: true, isLead: false }
                ];
            } else if (type.includes('cloth') || type.includes('apparel')) {
                chars = [
                    { name: 'Department', values: ['Men', 'Women'], isCategory: true, isLead: true },
                    { name: 'Type', values: ['Shirt', 'Pants', 'Jacket'], isCategory: true, isLead: false },
                    { name: 'Size', values: ['S', 'M', 'L', 'XL'], isCategory: true, isLead: false }
                ];
            } else if (type.includes('food') || type.includes('restaurant')) {
                chars = [
                    { name: 'Course', values: ['Main', 'Appetizer', 'Dessert', 'Drink'], isCategory: true, isLead: true },
                    { name: 'Dietary', values: ['Veg', 'Non-Veg', 'Vegan'], isCategory: true, isLead: false },
                    { name: 'Spiciness', values: ['Mild', 'Medium', 'Hot'], isCategory: true, isLead: false }
                ];
            } else {
                chars = [
                    { name: 'Category', values: ['Type A', 'Type B'], isCategory: true, isLead: true },
                    { name: 'Option', values: ['Option 1', 'Option 2'], isCategory: true, isLead: false }
                ];
            }
        }

        if (Array.isArray(chars)) {
            setNewItem(prev => ({...prev, characteristics: chars}));
            setShowAiModal(false);
        }
        setAiLoading(false);
    };

    // 🟢 AI SORT BUTTON LOGIC (REORDERING)
    const handleAiSortCharacteristics = () => {
        const sortedChars = [...newItem.characteristics];
        
        sortedChars.sort((a, b) => {
            // Priority 1: Lead always first
            if (a.isLead) return -1;
            if (b.isLead) return 1;

            // Priority 2: AI Hierarchy
            const indexA = AI_SORT_HIERARCHY.indexOf(normalize(a.name));
            const indexB = AI_SORT_HIERARCHY.indexOf(normalize(b.name));
            
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            
            return 0; 
        });

        setNewItem(prev => ({...prev, characteristics: sortedChars}));
    };


    const updateQuantity = (index: number, qty: number) => {
        setCartItems(prev => {
            const item = prev[index];
            if (!item) return prev;
            let nextQty = Math.max(0, qty);

            if (item.trackStock) {
                const latest = item.id ? menuItems.find(m => m.id === item.id) : null;
                const currentStock = Number(latest?.stock ?? item.stock ?? 0);

                if (!Number.isFinite(currentStock) || currentStock <= 0) {
                    setOrderStatus('Out of stock.');
                    nextQty = 0;
                } else if (nextQty > currentStock) {
                    setOrderStatus(`Only ${currentStock} left in stock.`);
                    nextQty = currentStock;
                }
            }

            return prev
                .map((ci, i) => (i === index ? { ...ci, quantity: nextQty } : ci))
                .filter(ci => ci.quantity > 0);
        });
    };
    const handleOwnerSignIn = async (e: string, p: string) => { try { await signInWithEmailAndPassword(auth, e, p); setOrderStatus(null); return true; } catch (err:any) { setOrderStatus('Invalid email or password.'); return false; } };
    const handleSignOut = async () => { await signOut(auth); setActiveSection('home'); };
    const handleArchiveOrder = async (order: Order) => { if(!db) return; const safeData = { ...order, archivedAt: serverTimestamp() }; if (safeData.fulfillment === undefined) safeData.fulfillment = null; if (safeData.deliveryInstructions === undefined) safeData.deliveryInstructions = null; await setDoc(doc(db, `artifacts/${appId}/public/data/order_history`, order.id), safeData); await deleteDoc(doc(db, `artifacts/${appId}/public/data/orders`, order.id)); };
    
    const handleCleanHistory = async (period: string) => { 
        if(!confirm("Delete history?")) return; 
        const now = Date.now(); const d = 86400000; let cutoff = now; 
        if(period === '1w') cutoff = now - 7*d; if(period === '1m') cutoff = now - 30*d; if(period === '3m') cutoff = now - 90*d; if(period === 'all') cutoff = now + d; 
        const toDelete = historyOrders.filter(o => { const t = o.archivedAt?.seconds ? o.archivedAt.seconds*1000 : (o.archivedAt||0); return t < cutoff; }); 
        await Promise.all(toDelete.map(o => deleteDoc(doc(db, `artifacts/${appId}/public/data/order_history`, o.id)))); setOrderStatus("success_history_cleaned"); 
    };

    const handleEditItem = (index: number) => {
        const item = dashboardMenuItems[index];
        setNewItem({ 
            name: item.name, 
            description: item.description, 
            price: item.price.toString(), 
            image: item.image, 
            stock: item.stock.toString(), 
            trackStock: item.trackStock, 
            characteristics: item.characteristics || [],
            media: item.media || (item.image ? [{type: 'image', url: item.image}] : [])
        });
        setEditingIndex(index);
        setShowNewProductForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };


    const handleCloneItem = (index: number) => {
        const item = dashboardMenuItems[index];
        setNewItem({ 
            name: item.name, 
            description: item.description, 
            price: item.price.toString(), 
            image: item.image, 
            stock: item.stock.toString(), 
            trackStock: item.trackStock, 
            characteristics: (item.characteristics || []).map(c => ({ ...c, values: [...(c.values || [])] })),
            media: item.media ? item.media.map(m => ({ ...m })) : (item.image ? [{ type: 'image', url: item.image }] : [])
        });
        setEditingIndex(null);
        setShowNewProductForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const openNewProductForm = () => {
        setEditingIndex(null);
        setShowNewProductForm(true);
        const base = (characteristicTemplate ?? newItem.characteristics ?? []).map(c => ({ ...c, values: [] }));
        const structure = base.length > 0
            ? base
            : (globalLeadCategory ? [{ name: capitalize(globalLeadCategory), values: [], isCategory: true, isLead: true }] : []);
        setNewItem({
            name: '', description: '', price: '', image: '', stock: '10', trackStock: STORE_CONFIG.type === 'retail',
            characteristics: structure, media: []
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => { 
        setNewItem({ name: '', description: '', price: '', image: '', stock: '10', trackStock: STORE_CONFIG.type === 'retail', characteristics: [{name: '', values: [], isCategory: true, isLead: true}], media: [] }); 
        setEditingIndex(null); 
    setShowNewProductForm(false);
    };

    // 🟢 GLOBAL ORDER SYNC
    const syncCharacteristicOrder = (masterOrder: Characteristic[], items: MenuItem[]): MenuItem[] => {
        const masterNames = masterOrder.map(c => normalize(c.name));
        
        return items.map(item => {
            if (!item.characteristics || item.characteristics.length === 0) return item;
            
            const sortedChars = [...item.characteristics].sort((a, b) => {
                const idxA = masterNames.indexOf(normalize(a.name));
                const idxB = masterNames.indexOf(normalize(b.name));
                
                // If both exist in master, use master order
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                // If only A exists, A comes first
                if (idxA !== -1) return -1;
                // If only B exists, B comes first
                if (idxB !== -1) return 1;
                // Otherwise keep relative
                return 0;
            });

            return { ...item, characteristics: sortedChars };
        });
    };

    
    const buildDraftIdentityKey = (item: Pick<MenuItem, 'name' | 'characteristics'>) => {
        const safeName = normalize(item.name || '');
        const chars = (item.characteristics || [])
            .map(c => {
                const cName = normalize(c?.name || '');
                const vals = (c?.values || []).map(v => normalize(v)).filter(Boolean).sort();
                return `${cName}=${vals.join(',')}`;
            })
            .filter(s => s !== '=')
            .sort();
        return `${safeName}|${chars.join('|')}`;
    };

// 🟢 AUTO-POPULATE LOGIC (INHERIT STRUCTURE)
    const handleLocalAddItem = (e: React.FormEvent) => { 
        e.preventDefault(); 
        if (!newItem.name || !newItem.price) return; 
        
        // 🟢 SYNC MAIN IMAGE: Use first image from media gallery or placeholder
        const mainImage = newItem.media && newItem.media.length > 0 ? newItem.media[0].url : `https://placehold.co/192x192/4F46E5/FFFFFF?text=${newItem.name}`;

        const itemData: MenuItem = { 
            name: newItem.name, 
            description: newItem.description, 
            price: parseFloat(newItem.price), 
            image: mainImage,
            stock: newItem.trackStock ? (parseInt(newItem.stock) || 0) : 0, 
            trackStock: newItem.trackStock, 
            characteristics: newItem.characteristics, 
            media: newItem.media,
            id: editingIndex !== null ? dashboardMenuItems[editingIndex].id : undefined 
        };
        
        if (editingIndex === null) {
            const newKey = buildDraftIdentityKey(itemData);
            const exists = dashboardMenuItems.some(existing => buildDraftIdentityKey(existing) === newKey);
            if (exists) {
                setOrderStatus("This item already exists in Created Drafts (Unsaved). Edit the existing item instead.");
                return;
            }
        }

        let updatedList: MenuItem[];

        if (editingIndex !== null) { 
            // Update Existing
            updatedList = [...dashboardMenuItems];
            updatedList[editingIndex] = itemData; 
            setEditingIndex(null); 
        } else { 
            // Add New
            updatedList = [...dashboardMenuItems, itemData]; 
        }

        // 🟢 APPLY GLOBAL ORDER TO ALL ITEMS
        updatedList = syncCharacteristicOrder(newItem.characteristics, updatedList);

        setDashboardMenuItems(updatedList);
        
        // 🟢 CHARACTERISTIC TEMPLATE: lock to the FIRST created item order
        const templateCandidate = characteristicTemplate ?? (itemData.characteristics?.map(c => ({ ...c, values: [] })) || []);
        if (editingIndex === null && characteristicTemplate === null && templateCandidate.length > 0) {
            setCharacteristicTemplate(templateCandidate);
        }

        // 🟢 PRESERVE STRUCTURE FOR NEXT ITEM (use template after the first item is created)
        const baseStructure = templateCandidate.length > 0
            ? templateCandidate
            : (globalLeadCategory ? [{ name: capitalize(globalLeadCategory), values: [], isCategory: true, isLead: true }] : []);
        const structure = baseStructure.map(c => ({ ...c, values: [] }));

        setNewItem({ name: '', description: '', price: '', image: '', stock: '10', trackStock: STORE_CONFIG.type === 'retail', characteristics: structure, media: [] }); 
        setHasUnsavedChanges(true);
 
    };

    const addCharacteristicToNewItem = () => { setNewItem(prev => ({...prev, characteristics: [...prev.characteristics, {name: '', values: [], isCategory: false}]})); };
    
    // 🟢 UPDATE CHAR NAME WITH FUZZY MATCH CHECK
    const updateCharacteristicName = (idx: number, val: string) => { 
        const chars = [...newItem.characteristics]; 
        chars[idx].name = val; // We store raw input temporarily for fluidity
        
        // 🟢 FUZZY MATCH LOGIC
        let bestMatch = null;
        let minDistance = Infinity;
        
        // Check fuzzy only if length > 2 to avoid annoying popups on "a" or "b"
        if(val.length > 2) {
            KNOWN_ATTRIBUTES_LIST.forEach(attr => {
                const dist = getLevenshteinDistance(normalize(val), normalize(attr));
                if (dist < 3 && dist > 0) { // Distance < 3 means close match, > 0 means not exact
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestMatch = attr;
                    }
                }
            });
        }

        if(bestMatch) {
            setTypoSuggestions({ index: idx, suggestion: bestMatch });
        } else {
            setTypoSuggestions(null);
        }

        const key = normalize(val);
        if (knownAttributes[key]?.isCategory) chars[idx].isCategory = true;
        if (knownAttributes[key]?.isLead) chars[idx].isLead = true;
        setNewItem({...newItem, characteristics: chars}); 
    };

    // 🟢 APPLY TYPO CORRECTION
    const applyTypoCorrection = (idx: number, suggestion: string) => {
        const chars = [...newItem.characteristics];
        chars[idx].name = suggestion;
        setNewItem({...newItem, characteristics: chars});
        setTypoSuggestions(null);
    };

    // 🟢 3. QUICK ADD HELPER
    const quickAddCharacteristic = (key: string) => {
        const info = knownAttributes[normalize(key)];
        setNewItem(prev => ({
            ...prev,
            characteristics: [...prev.characteristics, { name: capitalize(key), values: [], isCategory: info?.isCategory || false, isLead: info?.isLead || false }]
        }));
    };

    const updateCharacteristicValues = (idx: number, val: string) => { const chars = [...newItem.characteristics]; chars[idx].values = val.split(',').map(v=>v.trim()).filter(v=>v); setNewItem({...newItem, characteristics: chars}); };
    
    // 🟢 6. TOGGLE VALUE (SINGLE SELECT + ADD NEW)
    const toggleCharacteristicValue = (idx: number, val: string) => {
        const chars = [...newItem.characteristics];
        
        // 🟢 ALWAYS SINGLE SELECT IN EDITOR (Per User Request)
        chars[idx].values = [val];
        
        setNewItem({...newItem, characteristics: chars});
        setActiveValueDropdown(null); // Close on select
    };

    const updateCharacteristicCategory = (idx: number, val: boolean) => { const chars = [...newItem.characteristics]; chars[idx].isCategory = val; setNewItem({...newItem, characteristics: chars}); };
    
    // 🟢 5. LEAD TOGGLE (MOVE TO TOP LOGIC)
    const updateCharacteristicLead = (idx: number, val: boolean) => {
        if (!val) return; // Can't turn off lead directly, must pick new one

        let chars = [...newItem.characteristics];
        const target = chars[idx];
        
        // Remove from current position
        chars.splice(idx, 1);
        
        // Set properties
        target.isLead = true;
        target.isCategory = true;
        
        // Unset old leads
        chars.forEach(c => c.isLead = false);
        
        // Add to front
        chars = [target, ...chars];
        
        setNewItem({...newItem, characteristics: chars});
    };

    // 🟢 DRAG AND DROP HANDLERS
    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedCharIndex(index);
    };
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Necessary to allow dropping
    };
    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        if (draggedCharIndex === null) return;
        
        const chars = [...newItem.characteristics];
        const [movedItem] = chars.splice(draggedCharIndex, 1);
        chars.splice(dropIndex, 0, movedItem);
        
        // Ensure Lead logic still holds if we dragged something above lead
        if (dropIndex === 0) {
            chars.forEach(c => c.isLead = false);
            chars[0].isLead = true;
            chars[0].isCategory = true;
        } else if (draggedCharIndex === 0) {
             // If we moved the lead away from top, next one becomes lead
             chars.forEach(c => c.isLead = false);
             chars[0].isLead = true;
             chars[0].isCategory = true;
        }

        setNewItem({...newItem, characteristics: chars});
        setDraggedCharIndex(null);
    };


    const removeCharacteristic = (idx: number) => { const chars = newItem.characteristics.filter((_, i) => i !== idx); setNewItem({...newItem, characteristics: chars}); };

    const handleLocalDeleteByIndex = (index: number) => { const item = dashboardMenuItems[index]; if (item.id) { setDeletedIds(prev => { const n = new Set(prev); n.add(item.id!); return n; }); } setDashboardMenuItems(prev => prev.filter((_, i) => i !== index)); setHasUnsavedChanges(true); };
    const deleteStockItem = async (itemId: string) => { if (!confirm("Permanently delete this item?")) return; try { await deleteDoc(doc(db, `artifacts/${appId}/public/data/menu`, itemId)); setOrderStatus("Item deleted."); } catch (e) { console.error(e); } };
    
    // 🟢 CRITICAL FIX: CORRECT SAVE LOGIC
    const handleSaveChanges = async () => { 
        setIsSaving(true); 
        try { 
            // 1. Process Deletions
            const delPromises = Array.from(deletedIds).map(id => deleteDoc(doc(db, `artifacts/${appId}/public/data/menu`, id)));
            
            // 2. Process Upserts (Create OR Update)
            const upsertPromises = dashboardMenuItems.map(async (item) => {
                // 🔴 IMPORTANT: Create a copy and REMOVE undefined ID before saving
                const dataToSave = { ...item };
                delete dataToSave.id; 

                if (item.id) {
                    // Update Existing (using ID from state)
                    await updateDoc(doc(db, `artifacts/${appId}/public/data/menu`, item.id), dataToSave);
                    return item;
                } else {
                    // Create New
                    const ref = await addDoc(collection(db, `artifacts/${appId}/public/data/menu`), dataToSave);
                    return { ...item, id: ref.id }; // Return item with new ID
                }
            });

            await Promise.all(delPromises);
            const savedItems = await Promise.all(upsertPromises); // Get back items with IDs

            // 3. Update Local State with Real IDs from DB
            setDashboardMenuItems(savedItems);
            
            // 4. Success & Clean Up
            setOrderStatus('success_menu_update'); 
            setHasUnsavedChanges(false); 
            setDeletedIds(new Set()); 
            
            // 🟢 CLEAN THE BACKUP: We saved successfully, so DB is now source of truth.
            localStorage.removeItem(`saffron_drafts_v1_${appId}`);

        } catch (error: any) { 
            console.error(error);
            setOrderStatus('Save Failed. Check Connection.'); 
        } finally { 
            setIsSaving(false); 
            setTimeout(() => setOrderStatus(null), 3000); 
        } 
    };

    // 🟢 DIRECT STOCK UPDATE
    const updateItemStock = async (itemId: string, newStock: number) => {
        // Never allow negative stock values
        const safeStock = Math.max(0, Math.floor(Number(newStock) || 0));
        try {
            await updateDoc(doc(db, `artifacts/${appId}/public/data/menu`, itemId), { stock: safeStock });
        } catch (e) {
            console.error("Stock update failed", e);
        }
    };

    // 🟢 ADD MEDIA TO GALLERY
    const addMediaToItem = async (e?: React.ChangeEvent<HTMLInputElement>) => {
        let url = mediaInputValue;
        let type: 'image' | 'video' = 'image';

        // Handle File Upload (Simulated with Base64)
        if (e?.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            
            if (file.size > 500000) { // Warn if > 500KB
                alert("File too large for local prototype. Please use URL or file < 500KB.");
                return;
            }

            reader.onloadend = () => {
                const base64 = reader.result as string;
                type = file.type.startsWith('video') ? 'video' : 'image';
                
                // Add to state
                setNewItem(prev => ({
                    ...prev,
                    media: [...(prev.media || []), { type, url: base64 }]
                }));
            };
            reader.readAsDataURL(file);
            return;
        }

        // Handle URL Input
        if (url) {
            // Simple heuristic to guess type (can be user overridden later if needed)
            if (url.match(/\.(mp4|webm|ogg)$/i) || url.includes('youtube') || url.includes('vimeo')) {
                type = 'video';
            }
            setNewItem(prev => ({
                ...prev,
                media: [...(prev.media || []), { type, url }]
            }));
            setMediaInputValue('');
        }
    };

    const removeMedia = (index: number) => {
        setNewItem(prev => ({
            ...prev,
            media: prev.media?.filter((_, i) => i !== index)
        }));
    };

    const callGemini = async (prompt: string) => { if(!apiKey) return "AI Disabled"; setAiLoading(true); try { const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${apiKey}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }); const d = await r.json(); setAiLoading(false); return d.candidates?.[0]?.content?.parts?.[0]?.text || "Error"; } catch { setAiLoading(false); return "Error"; } };
    const generateDescription = async (item: MenuItem) => { const txt = await callGemini(`Describe ${item.name}: ${item.description}`); setAiResult({ dishName: item.name, type: 'description', text: txt }); };
    const generatePairing = async (item: MenuItem) => { const txt = await callGemini(`Pairing for ${item.name}`); setAiResult({ dishName: item.name, type: 'pairing', text: txt }); };

    const OrderStatusMessage = ({ status }: { status: string | null }) => {
        if (!status) return null; let color = 'bg-red-500', text = status, Icon = XCircle;
        if (status === 'payment_success') { color = 'bg-emerald-600'; text = 'Payment Successful! Order Confirmed.'; Icon = DollarSign; }
        else if (status === 'success_history_cleaned') { color = 'bg-green-600'; text = 'History Cleaned.'; Icon = Trash2; }
        else if (status === 'success_menu_update') { color = 'bg-green-600'; text = 'Menu Saved & Synced.'; Icon = CheckCheck; }
        return <div className={`fixed top-4 right-4 z-50 p-4 rounded-xl text-white font-semibold flex items-center shadow-2xl ${color} animate-bounce-in`}><Icon className="w-6 h-6 mr-3"/> {text}</div>;
    };

    const NavButton = ({ sectionName, label, IconComponent, count, isOwner = false }: any) => {
        const activeClasses = activeSection === sectionName ? `shadow-2xl ring-4 ${isOwner?'ring-gray-400':'ring-purple-400'} scale-105 ring-offset-4 ring-offset-gray-100` : `${isOwner?'hover:bg-gray-900':'hover:bg-purple-700'} shadow-lg`;
        return ( <button onClick={() => setActiveSection(sectionName)} className={`w-24 h-24 md:w-28 md:h-28 rounded-full flex flex-col items-center justify-center font-semibold text-white text-xs md:text-sm font-sans transition duration-300 transform flex-shrink-0 ${isOwner?'bg-gray-800':'bg-purple-600'} ${activeClasses}`}><IconComponent className="mb-1" size={24} /> <span>{count ? `${label} (${count})` : label}</span></button> );
    };

    const MobileNavButton = ({ sectionName, IconComponent, count = 0, label }: any) => (
        <button onClick={() => setActiveSection(sectionName)} className={`flex flex-col items-center p-2 transition-colors duration-200 relative ${activeSection === sectionName ? 'text-purple-600' : 'text-gray-500 hover:text-purple-600'} w-full`}>{activeSection === sectionName && <div className={`absolute top-0 w-8 h-1 rounded-b-full ${sectionName === 'dashboard' ? 'border-gray-800' : 'border-purple-600'}`}></div>}<IconComponent className="w-6 h-6" />{count > 0 && sectionName === 'cart' && <span className="absolute top-1 right-3 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">{count}</span>}<span className="text-[10px] mt-1 font-semibold">{label}</span></button>
    );

    // 🟣 ORDER ITEM DISPLAY: show distinguishing characteristics (same style as Created Drafts chips)
    const getOrderItemChips = (orderItem: any): string[] => {
        try {
            const selected =
                (orderItem?.selectedOptions && typeof orderItem.selectedOptions === 'object')
                    ? orderItem.selectedOptions
                    : {};

            const mi =
                menuItems.find(m => m.id && orderItem?.id && m.id === orderItem.id) ||
                menuItems.find(m => normalize(m.name) === normalize(orderItem?.name || ''));

            const characteristics: Characteristic[] = Array.isArray(mi?.characteristics) ? (mi!.characteristics as Characteristic[]) : [];

            // Build a stable, human-friendly order: known attributes first, then any remaining characteristics
            const ordered: Characteristic[] = [];
            const taken = new Set<string>();
            const pushChar = (c: Characteristic) => {
                const k = normalize(c.name);
                if (!k || taken.has(k)) return;
                taken.add(k);
                ordered.push(c);
            };

            const knownOrderNorm = KNOWN_ATTRIBUTES_LIST.map(n => normalize(n));
            knownOrderNorm.forEach(k => {
                const found = characteristics.find(c => normalize(c.name) === k);
                if (found) pushChar(found);
            });
            characteristics.forEach(pushChar);

            const usedKeys = new Set<string>();
            const rawValues: string[] = [];

            const getSelectedForKeyNorm = (keyNorm: string): any => {
                const entry = Object.entries(selected).find(([k]) => normalize(k) === keyNorm);
                return entry ? entry[1] : undefined;
            };

            ordered.forEach(c => {
                const keyNorm = normalize(c.name);
                usedKeys.add(keyNorm);

                const candidate = getSelectedForKeyNorm(keyNorm);
                const value = (candidate ?? c.values?.[0] ?? '').toString().trim();
                if (value) rawValues.push(value.toUpperCase());
            });

            // Include any extra selected options (defensive), excluding non-identity fields
            Object.entries(selected).forEach(([k, v]) => {
                const keyNorm = normalize(k);
                if (!keyNorm || usedKeys.has(keyNorm)) return;
                if (['stock', 'price', 'quantity', 'subtotal', 'total', 'id', 'name', 'trackstock'].includes(keyNorm)) return;

                const value = (v ?? '').toString().trim();
                if (value) rawValues.push(value.toUpperCase());
            });

            // De-duplicate (preserve order)
            const seen = new Set<string>();
            return rawValues.filter(v => {
                if (seen.has(v)) return false;
                seen.add(v);
                return true;
            });
        } catch {
            return [];
        }
    };

    const getOrderItemImageUrl = (orderItem: any): string => {
        try {
            // Prefer media image, fall back to the legacy 'image' field
            const mi =
                menuItems.find(m => m.id && orderItem?.id && m.id === orderItem.id) ||
                menuItems.find(m => normalize(m.name) === normalize(orderItem?.name || ''));

            const mediaImg = mi?.media?.find(m => m.type === 'image')?.url;
            const img = (mediaImg || mi?.image || '').toString().trim();
            return img;
        } catch {
            return '';
        }
    };




    const Ticket = ({ order }: { order: Order }) => {
        const isPaid = order.status === 'Paid'; const isWorking = order.status !== 'Done';
        const updateStatus = (s: string) => updateDoc(doc(db, `artifacts/${appId}/public/data/orders`, order.id), { status: s });
        const fulfillmentText = order.fulfillment ? (order.fulfillment.type === 'shipping' && order.fulfillment.address ? `Ship: ${order.fulfillment.address.city}, ${order.fulfillment.address.zip}` : `Note: ${order.fulfillment.instructions || 'None'}`) : `Legacy: ${order.deliveryInstructions || 'No Info'}`;
        return (
            <div className={`p-4 shadow-lg rounded-xl flex flex-col justify-between ${isWorking ? (isPaid ? 'bg-indigo-50 border-t-4 border-indigo-500' : 'bg-amber-50 border-t-4 border-amber-500') : 'bg-green-50 border-t-4 border-green-500'}`}>
                <div className="flex justify-between items-start mb-3"><h3 className="text-lg font-bold">#{order.id.substring(0,6)}</h3><span className={`text-xs px-2 py-1 rounded-full font-bold bg-white/50`}>{isPaid?'PAID':(isWorking?'UNPAID':'READY')}</span></div>
                <p className="text-xl font-extrabold">{order.customerName}</p>
                <div className="text-xs text-gray-600 bg-white/50 p-2 rounded mb-2"><FulfillmentIcon size={12} className="inline mr-1"/> {fulfillmentText}</div>
                <p className="text-lg font-bold text-purple-700">${order.totalAmount.toFixed(2)}</p>
                                <div className="text-sm mb-4 space-y-2">
                    {order.items.map((i, x) => {
                        const chips = getOrderItemChips(i);
                        const imgUrl = getOrderItemImageUrl(i);
                        return (
                            <div key={x} className="flex gap-3">
                                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                                    {imgUrl ? (
                                        <img src={imgUrl} alt={i.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                                            <ImageIcon size={18} />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-baseline">
                                        <span>
                                            {i.quantity}x <b>{i.name}</b>{" "}
                                            <span className="text-gray-500 font-medium">at ${i.price.toFixed(2)}</span>
                                        </span>
                                        <span className="font-semibold">${(typeof i.subtotal === 'number' ? i.subtotal : i.price * i.quantity).toFixed(2)}</span>
                                    </div>
                                    {chips.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {chips.map((v, idx) => (
                                                <span
                                                    key={idx}
                                                    className="px-2 py-1 rounded-full text-[10px] font-extrabold tracking-wide border border-slate-200 bg-slate-50 text-slate-700"
                                                >
                                                    {v}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );})}
                </div>
                {isWorking ? <button onClick={()=>updateStatus('Done')} className="w-full bg-emerald-600 text-white py-2 rounded font-bold">Done</button> : <div className="flex gap-2"><button onClick={()=>updateStatus(isPaid?'Paid':'Pending Payment/Unpaid')} className="flex-1 bg-sky-100 text-sky-800 py-2 rounded">Undo</button><button onClick={()=>handleArchiveOrder(order)} className="bg-gray-500 text-white px-4 py-2 rounded"><Archive/></button></div>}
            </div>
        );
    };

    const renderHome = () => (
        <div className="text-center py-16 px-4 bg-purple-50 rounded-2xl shadow-xl relative overflow-hidden">
            <BrandIcon className="w-16 h-16 mx-auto mb-4 text-purple-600" />
            <h2 className="text-6xl font-extrabold font-serif mb-4">{STORE_CONFIG.name}</h2>
            <p className="text-xl text-gray-600 mb-8">{STORE_CONFIG.description}</p>
            <div className="flex justify-center gap-6">
                <button onClick={()=>setActiveSection('menu')} className="bg-purple-600 text-white font-bold py-3 px-8 rounded-full shadow-lg transform hover:scale-105 transition">View {labels.menu}</button>
                <button onClick={()=>setActiveSection('dashboard')} className="bg-gray-800 text-white font-bold py-3 px-8 rounded-full shadow-lg transform hover:scale-105 transition flex items-center"><ChefHat className="mr-2"/> Dashboard</button>
            </div>
        </div>
    );

    const renderMenu = () => {
        // Grouped catalog cards open the VisualProductSearch wizard using catalogIsolateItems
        if (catalogIsolateItems && catalogIsolateItems.length > 0) {
            return (
                <VisualProductSearch
                    items={catalogIsolateItems}
                    initialSearchTerm={catalogIsolateTerm}
                    productName={catalogIsolateTerm || catalogIsolateItems[0]?.name || ''}
                    onClose={() => {
                        setCatalogIsolateItems(null);
                        setCatalogIsolateTerm('');
                    }}
                    onAddToCart={(item, options) => {
                        addToCart(item, options);
                        setCatalogIsolateItems(null);
                        setCatalogIsolateTerm('');
                    }}
                />
            );
        }
        if (isolatedItem) {
            return (
                <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
                    <button onClick={() => setIsolatedItem(null)} className="flex items-center text-gray-600 hover:text-purple-600 font-bold transition">
                        <ArrowLeft className="mr-2"/> Back to Full Menu
                    </button>
                    <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
                        <img src={isolatedItem.image} className="w-full h-80 object-cover" onError={(e)=>{e.currentTarget.src="https://placehold.co/600x400?text=Dish"}}/>
                        <div className="p-8">
                            <div className="flex justify-between items-start mb-4"><h2 className="text-4xl font-extrabold font-serif">{isolatedItem.name}</h2><span className="text-3xl font-bold text-purple-600">${isolatedItem.price.toFixed(2)}</span></div>
                            <p className="text-gray-600 text-lg mb-8 leading-relaxed">{isolatedItem.description}</p>
                            {isolatedItem.characteristics && (
                                <div className="flex flex-wrap gap-2 mb-8">{isolatedItem.characteristics.map(char => (<span key={char.name} className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700 font-medium">{toTitleCase(char.name)}: {char.values.join(', ')}</span>))}</div>
                            )}
                            <button onClick={()=>addToCart(isolatedItem, null)} className="w-full bg-purple-600 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-purple-700 transition transform hover:scale-[1.02] text-xl"><ShoppingCart className="inline mr-2"/> Add to Cart</button>
                        </div>
                    </div>
                </div>
            );
        }

        // 🟢 1. VISUAL PRODUCT SEARCH TRIGGER (Updated for Broad Matching)
        // If the search matches the START of item names (min 3 chars), and multiple items exist, trigger wizard.
        if (searchQuery.length > 2) {
            const normalizedQuery = normalize(searchQuery);
            // Group items by name to find matches that start with the query
            const broadMatchGroup = menuItems.filter(i => normalize(i.name).startsWith(normalizedQuery));
            
            // Trigger visual mode if we have results
            if (broadMatchGroup.length > 0) {
                return (
                    <VisualProductSearch 
                        items={broadMatchGroup} 
                        initialSearchTerm={searchQuery}
                        productName={broadMatchGroup[0].name} 
                        onClose={() => setSearchQuery('')} 
                        onAddToCart={addToCart} 
                    />
                );
            }
        }

        // 🟢 2. STANDARD FILTERING
        const filteredItems = menuItems.filter(item => {
            if (item.trackStock && item.stock <= 0) return false;
            const matchesFilters = Object.entries(activeFilters).every(([catName, activeVal]) => {
                const char = item.characteristics?.find(c => normalize(c.name) === normalize(catName));
                return char && char.values.some(v => normalize(v) === normalize(activeVal));
            });
            if (!matchesFilters) return false;
            if (searchQuery) {
                const tokens = searchQuery.toLowerCase().split(' ').filter(t => t.trim() !== '');
                const itemString = `${item.name} ${item.characteristics?.flatMap(c => c.values).join(' ')}`.toLowerCase();
                return tokens.every(token => itemString.includes(token));
            }
            return true;
        });

        const toggleFilter = (cat: string, val: string) => {
            setActiveFilters(prev => {
                const next = { ...prev };
                if (normalize(next[cat] || '') === normalize(val)) delete next[cat]; else next[cat] = normalize(val);
                return next;
            });
        };

        // 🟢 3. SMART PARTITIONING LOGIC (BEAUTIFY)
        // Find the Lead Characteristic (usually the first one)
        const globalLead = menuItems.length > 0 ? menuItems[0].characteristics?.[0] : null;
        
        // Group items based on Lead Value (e.g. "Main", "Drink" OR "Men", "Women")
        const partitionedMenu: Record<string, MenuItem[]> = {};
        
        if (globalLead) {
            filteredItems.forEach(item => {
                const leadChar = item.characteristics?.find(c => normalize(c.name) === normalize(globalLead.name));
                const leadVal = leadChar ? leadChar.values[0] : 'Other'; // "Men"
                
                // Try to find a secondary characteristic for cleaner grouping (e.g. "Shoes")
                const secondaryChar = item.characteristics?.[1]; // 2nd characteristic
                
                let key = leadVal;
                if (secondaryChar && secondaryChar.isCategory) {
                    const secondaryVal = secondaryChar.values[0];
                    if (secondaryVal) key = `${leadVal} • ${secondaryVal}`; // "Men • Shoes"
                }

                if (!partitionedMenu[key]) partitionedMenu[key] = [];
                partitionedMenu[key].push(item);
            });
        } else {
            partitionedMenu['Catalog'] = filteredItems;
        }

        const sortedKeys = Object.keys(partitionedMenu).sort();

        return (
            <div className="space-y-8">
                <h2 className="text-4xl font-extrabold font-sans flex items-center"><CatalogIcon className="w-8 h-8 mr-3 text-purple-600"/> {labels.menu}</h2>
                <div className="bg-white p-4 rounded-xl shadow-md border border-gray-100 flex flex-col md:flex-row flex-wrap gap-3 items-center mb-8 sticky top-0 z-40">
                    
                    {/* 🟢 SEARCH INPUT */}
                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18}/>
                        <input 
                            type="text" 
                            placeholder="Search (e.g. Nike Air Max)" 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border rounded-full text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                        />
                    </div>

                    <div className="flex items-center text-gray-500 mr-2 border-l pl-4 hidden md:flex"><span className="font-bold text-sm">Refine:</span></div>
                    {Object.entries(activeFilters).map(([cat, val]) => (
                        <div key={cat} className="flex items-center bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-bold border border-purple-200">
                            <span className="mr-1 opacity-75">{toTitleCase(cat)}:</span> {capitalize(val)}
                            <button onClick={()=>toggleFilter(cat, val)} className="ml-2 hover:bg-purple-200 rounded-full p-0.5"><X size={14}/></button>
                        </div>
                    ))}
                    {/* 🟢 BROWSE MENU SHOULD NOT INCLUDE OUT-OF-STOCK ITEMS */}
                    <SmartCategoryMenu
                        items={menuItems.filter(i => !(i.trackStock && i.stock <= 0))}
                        activeFilters={activeFilters}
                        onApplyFilter={(c,v) => toggleFilter(c,v)}
                        onItemClick={handleSmartMenuClick}
                    />
                    {(Object.keys(activeFilters).length > 0 || searchQuery) && <button onClick={() => {setActiveFilters({}); setSearchQuery('');}} className="text-xs text-red-500 hover:underline font-bold ml-auto">Clear All</button>}
                </div>

                {/* 🟢 4. BEAUTIFIED SECTIONS */}
                <div className="space-y-12">
                    {sortedKeys.map(sectionTitle => (
                        <div key={sectionTitle} className="animate-fade-in">
                            <div className="flex items-center gap-4 mb-6">
                                <h3 className="text-2xl font-bold text-gray-800 uppercase tracking-tight flex items-center">
                                    <span className="bg-purple-600 w-2 h-8 mr-3 rounded-full"></span>
                                    {toTitleCase(sectionTitle)}
                                </h3>
                                <div className="h-px bg-gray-200 flex-grow"></div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                                {groupMenuItemsForCatalog(partitionedMenu[sectionTitle]).map(group => (
                                    <GroupedMenuGridItem
                                        key={group.key}
                                        item={group.item}
                                        variantsCount={group.variants.length}
                                        onPreview={() => setCatalogPreviewGroup(group)}
                                        onAction={() => {
                                            if (group.variants.length === 1) {
                                                handleItemClick(group.variants[0]);
                                            } else {
                                                setCatalogIsolateItems(group.variants);
                                                setCatalogIsolateTerm(group.item.name);
                                            }
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                    {sortedKeys.length === 0 && <div className="text-center py-20 text-gray-400">No items found matching your criteria.</div>}
                </div>
            </div>
        );
    };

    const renderCart = () => (
        <div className="max-w-4xl mx-auto space-y-8">
            <h2 className="text-4xl font-extrabold font-sans flex items-center"><ShoppingCart className="w-8 h-8 mr-3 text-purple-600"/> Your {labels.cart}</h2>
            {cartItems.length===0 ? (
                <div className="text-center p-12 bg-gray-50 rounded-2xl"><p className="text-xl text-gray-500">Cart is empty.</p><button onClick={()=>setActiveSection('menu')} className="mt-6 bg-purple-600 text-white font-bold py-3 px-6 rounded-xl">View {labels.menu}</button></div>
            ) : (
                <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-xl p-4 divide-y divide-purple-100">
                        {cartItems.map((i, idx)=>(
                            <div key={idx} className="flex justify-between items-center py-4">
                                <div className="flex items-center gap-4">
                                    <img src={i.image} className="w-16 h-16 rounded object-cover"/>
                                    <div>
                                        <p className="font-bold">{i.name}</p>
                                        <p className="text-sm font-bold text-purple-700">${(i.price * i.quantity).toFixed(2)}</p>
                                        {/* 🟢 ALWAYS SHOW CHARACTERISTICS (SAME STYLE AS CREATED DRAFTS) */}
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {(i.characteristics ?? []).map((c) => {
                                                const normName = normalize(c.name);
                                                const selected =
                                                    i.selectedOptions
                                                        ? (i.selectedOptions[c.name] ?? i.selectedOptions[normName])
                                                        : undefined;
                                                const val = selected ?? (c.values?.[0] ?? '');
                                                if (!val) return null;
                                                return (
                                                    <span
                                                        key={c.name}
                                                        className="px-2 py-0.5 text-[10px] uppercase font-bold text-slate-300 bg-slate-700 rounded border border-slate-600"
                                                    >
                                                        {val}
                                                    </span>
                                                );
                                            })}
                                            {i.selectedOptions &&
                                                Object.entries(i.selectedOptions)
                                                    .filter(([k, v]) => {
                                                        const normKey = normalize(k);
                                                        return !(i.characteristics ?? []).some(
                                                            (c) => normalize(c.name) === normKey
                                                        );
                                                    })
                                                    .map(([k, v]) => (
                                                        <span
                                                            key={k}
                                                            className="px-2 py-0.5 text-[10px] uppercase font-bold text-slate-300 bg-slate-700 rounded border border-slate-600"
                                                        >
                                                            {v}
                                                        </span>
                                                    ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 border rounded-full p-1">
                                    <button onClick={()=>updateQuantity(idx, i.quantity-1)} className="p-2 text-purple-600"><Minus size={16}/></button><span className="font-bold">{i.quantity}</span><button onClick={()=>updateQuantity(idx, i.quantity+1)} className="p-2 text-purple-600"><Plus size={16}/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => setActiveSection('checkout')} className="w-full bg-green-500 text-white font-bold py-4 rounded-xl shadow-lg text-xl"><CreditCard className="inline mr-2"/> Proceed to Checkout (${calculateTotal().toFixed(2)})</button>
                </div>
            )}
        </div>
    );

    const renderCheckout = () => {
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
                            setPaymentIntentClientSecret(null); 
                            setOrderStatus(status); 
                            setActiveSection('menu'); 
                        }} 
                        onError={(err: string) => setOrderStatus(err)} 
                        refreshKey={stripeRefreshKey} 
                    />
                </div>
                <button onClick={() => setActiveSection('cart')} className="w-full text-sm text-gray-500 hover:text-purple-600 transition font-medium flex items-center justify-center pt-2">&larr; Back to {labels.cart}</button>
            </div>
        );
    };

    const renderDashboard = () => {
        if (!isOwner) return <OwnerLogin onLogin={handleOwnerSignIn} />;
        return (
            <div className="space-y-8">
                <div className="flex justify-between items-center flex-wrap gap-4 min-w-0">
                    <h2 className="text-4xl font-extrabold flex items-center"><ChefHat className="mr-3"/> Dashboard</h2>
                    <div className="flex items-center justify-end gap-3 flex-wrap min-w-0 max-w-full">
                        <div className="flex bg-gray-200 rounded-lg p-1 overflow-x-auto max-w-full whitespace-nowrap">
                            <button onClick={()=>setDashboardTab('orders')} className={`px-4 py-2 rounded-lg font-bold transition shrink-0 ${dashboardTab==='orders'?'bg-white text-gray-900 shadow':'text-gray-500 hover:text-gray-900'}`}><span className="relative inline-flex items-center">Orders{orders.filter(o=>o.status!=='Done').length > 0 && (<span className="absolute -top-2 -right-3 bg-red-600 text-white text-[10px] font-black rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center shadow">{orders.filter(o=>o.status!=='Done').length}</span>)}</span></button>
                            <button onClick={()=>setDashboardTab('stock')} className={`px-4 py-2 rounded-lg font-bold transition shrink-0 ${dashboardTab==='stock'?'bg-white text-gray-900 shadow':'text-gray-500 hover:text-gray-900'}`}>Stock</button>
                            <button onClick={()=>setDashboardTab('menu')} className={`px-4 py-2 rounded-lg font-bold transition shrink-0 ${dashboardTab==='menu'?'bg-white text-gray-900 shadow':'text-gray-500 hover:text-gray-900'}`}>{labels.menu}</button>
                            <button onClick={()=>setDashboardTab('history')} className={`px-4 py-2 rounded-lg font-bold transition shrink-0 ${dashboardTab==='history'?'bg-white text-gray-900 shadow':'text-gray-500 hover:text-gray-900'}`}>History</button>
                        </div>
                        <button onClick={handleSignOut} className="bg-red-600 text-white font-bold py-2 px-4 rounded-xl shadow shrink-0">Sign Out</button>
                    </div>
                </div>

                {dashboardTab === 'orders' ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white p-5 rounded-xl shadow-2xl"><h2 className="text-2xl font-bold text-amber-700 mb-4 border-b-4 border-amber-500 pb-2">Working On ({orders.filter(o=>o.status!=='Done').length})</h2><div className="space-y-4">{orders.filter(o=>o.status!=='Done').map(o=><Ticket key={o.id} order={o}/>)}</div></div>
                        <div className="bg-white p-5 rounded-xl shadow-2xl"><h2 className="text-2xl font-bold text-green-700 mb-4 border-b-4 border-green-500 pb-2">Done ({orders.filter(o=>o.status==='Done').length})</h2><div className="space-y-4">{orders.filter(o=>o.status==='Done').map(o=><Ticket key={o.id} order={o}/>)}</div></div>
                    </div>
                ) : dashboardTab === 'history' ? (
                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-full flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3">
                            <div><h3 className="text-2xl font-bold flex items-center text-gray-800"><History className="mr-2"/> Order History</h3></div>
                            <div className="flex flex-wrap gap-2 items-center"><button onClick={() => handleCleanHistory('3m')} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1 rounded text-xs font-bold border border-gray-300">Keep Last 3 Months</button><button onClick={() => handleCleanHistory('1m')} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1 rounded text-xs font-bold border border-gray-300">Keep Last Month</button><button onClick={() => handleCleanHistory('all')} className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1 rounded text-xs font-bold border border-red-200">Delete All</button></div>
                        </div>
                        
                        <div className="bg-white rounded-xl shadow-xl overflow-hidden">
                             {historyOrders.map(order => (
                                 <div key={order.id} className="p-4 hover:bg-gray-50 flex flex-col gap-4 border-b border-gray-100 last:border-0">
                                     <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                                         <div className="min-w-0">
                                             <div className="text-sm font-normal text-gray-500">#{order.id.substring(0,6)}</div>
                                              <div className="font-bold text-gray-800 text-lg">{order.customerName}</div>
                                             <div className="text-xs text-gray-500">{order.timestamp?.seconds ? new Date(order.timestamp.seconds * 1000).toLocaleString() : 'Date N/A'}</div>
                                         </div>
                                         <div className="w-full lg:w-auto lg:text-right flex flex-col items-start lg:items-end gap-1">
                                             <div className="font-bold text-purple-700 text-lg">${order.totalAmount.toFixed(2)}</div>
                                             <div className="text-xs text-gray-500 mt-1">{order.payment?.brand} •••• {order.payment?.last4} {order.payment?.expMonth && `(${order.payment.expMonth}/${order.payment.expYear})`}</div>
                                         </div>
                                     </div>
                                     <div className="bg-gray-100 p-3 rounded-lg text-sm text-gray-700">
                                         <p className="font-bold text-xs text-gray-500 uppercase mb-2">Order Details</p>
                                         {order.items.map((item, idx) => {
                                            const chips = getOrderItemChips(item);
                                            const imgUrl = getOrderItemImageUrl(item);
                                            return (
                                                <div key={idx} className="border-b border-gray-200 last:border-0 py-2">
                                                    <div className="flex gap-3">
                                                        <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                                                            {imgUrl ? (
                                                                <img src={imgUrl} alt={item.name} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                                    <ImageIcon size={18} />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex-1">
                                                            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                                                                <span>
                                                                    {item.quantity}x {item.name}{" "}
                                                                    <span className="text-gray-500 font-medium">at ${item.price.toFixed(2)}</span>
                                                                </span>
                                                                <span className="font-semibold whitespace-nowrap">${item.subtotal.toFixed(2)}</span>
                                                            </div>
                                                            {chips.length > 0 && (
                                                                <div className="mt-1 flex flex-wrap gap-1">
                                                                    {chips.map((v: string, vi: number) => (
                                                                        <span
                                                                            key={vi}
                                                                            className="px-2 py-1 rounded-full text-[10px] font-extrabold tracking-wide border border-slate-200 bg-slate-50 text-slate-700"
                                                                        >
                                                                            {v}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                     </div>
                                 </div>
                         ))}
                        </div>
                    </div>
                ) : dashboardTab === 'stock' ? (
                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-xl">
                            <h3 className="text-2xl font-bold flex items-center mb-6"><Layers className="mr-2"/> Inventory & Stock</h3>
                            <div className="mt-4 space-y-3">
    <div className="text-sm text-gray-600 leading-relaxed">
                                    Set a global threshold. Items at or below this stock level will be tagged as <span className="font-bold">Low Stock</span> in the Dashboard.
                                </div>
    <div className="flex items-center gap-3 flex-wrap">
                                    <label className="text-sm font-bold text-gray-800 whitespace-nowrap">Low-stock threshold</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={globalLowStockThreshold}
                                        onChange={(e) => setGlobalLowStockThreshold(Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
                                        className="w-24 px-3 py-2 rounded-xl border-2 border-gray-200 font-bold outline-none focus:border-purple-500"
                                    />
                                </div>
</div>

<div className="mt-4 w-full max-w-full overflow-x-auto">
                                <table className="w-full min-w-[760px] table-fixed text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-gray-200 text-gray-500 text-sm">
                                            <th className="py-3 pl-4 w-[260px]">Item</th>
                                            <th className="py-3">Details</th>
                                            <th className="py-3 w-[140px]">Stock</th>
                                            <th className="py-3 w-[90px]">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {menuItems.filter(i => i.trackStock).map(item => (
                                            <tr key={item.id || item.name} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                                                <td className="py-4 pl-4 font-bold text-gray-800 flex items-center">
                                                    {/* 🟢 STOCK IMAGE THUMBNAIL */}
                                                    <img src={item.image} className="w-10 h-10 rounded-full object-cover mr-3 border" onError={(e)=>{e.currentTarget.src="https://placehold.co/40"}} />
                                                    {item.name}
                                                    {isLowStockItem(item) && (
                                                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200">
                                                            Low Stock
                                                        </span>
                                                    )}

                                                </td>
                                                <td className="py-4 break-words">
                                                    {item.characteristics ? item.characteristics.map(c => (
                                                        <span key={c.name} className="inline-block bg-gray-100 text-xs px-2 py-1 rounded mr-1 mb-1 border border-gray-200">
                                                            <strong>{toTitleCase(c.name)}:</strong> {c.values.join(', ')}
                                                        </span>
                                                    )) : <span className="text-gray-400 text-xs">None</span>}
                                                </td>
                                                <td className="py-4 break-words">
                                                    <input 
                                                        type="number"
                                                        defaultValue={item.stock}
                                                        onBlur={(e) => updateItemStock(item.id!, parseInt(e.target.value) || 0)}
                                                        className={`w-24 px-3 py-1 rounded-full text-sm font-bold border outline-none text-center transition-colors ${!isLowStockItem(item) ? 'bg-green-100 text-green-800 border-green-200 focus:border-green-500' : 'bg-red-100 text-red-800 border-red-200 focus:border-red-500'}`}
                                                    />
                                                </td>
                                                <td className="py-4">
                                                    {item.id && (
                                                        <button onClick={() => deleteStockItem(item.id!)} className="text-red-500 bg-red-100 p-2 rounded hover:bg-red-200 transition"><Trash2 size={16}/></button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-8 max-w-6xl mx-auto w-full">
                        <div className="bg-white p-6 rounded-xl shadow-xl relative">
                                                        {editingIndex === null && !showNewProductForm ? (
                                                            <div className="space-y-4">
                                                                <button
                                                                    type="button"
                                                                    onClick={openNewProductForm}
                                                                    className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white font-bold py-3 rounded-xl shadow-md hover:bg-purple-700 transition"
                                                                >
                                                                    <Plus size={18}/> + Add New {labels.item}
                                                                </button>
                                                                {menuItems.length === 0 && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setShowAiModal(true)}
                                                                        className="w-full flex items-center justify-center text-xs bg-indigo-50 text-indigo-600 font-semibold px-3 py-2 rounded-lg hover:bg-indigo-100 transition border border-indigo-200"
                                                                    >
                                                                        <Sparkles size={14} className="mr-2"/> Auto-Build Store Structure...
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div className="flex justify-between items-start mb-6">
                                                                    <h3 className="text-xl font-bold flex items-center">
                                                                        {editingIndex !== null ? <Edit className="mr-2"/> : <Plus className="mr-2"/>}
                                                                        {editingIndex !== null ? "Edit Item" : `Add New ${labels.item}`}
                                                                    </h3>
                                                                    <div className="flex items-center gap-2">
                                                                        {menuItems.length === 0 && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setShowAiModal(true)}
                                                                                className="flex items-center text-xs bg-indigo-50 text-indigo-600 font-bold py-2 px-3 rounded-lg hover:bg-indigo-100 transition border border-indigo-200"
                                                                            >
                                                                                <Sparkles size={14} className="mr-2"/> Auto-Build Store Structure...
                                                                            </button>
                                                                        )}
                                                                        {editingIndex === null && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setShowNewProductForm(false)}
                                                                                className="text-gray-500 hover:text-black p-2 rounded-lg hover:bg-gray-100 transition"
                                                                                title="Close"
                                                                            >
                                                                                <X size={18}/>
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>

<form onSubmit={handleLocalAddItem} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input placeholder="Name" className="p-3 border rounded" value={newItem.name} onChange={e=>setNewItem({...newItem, name: e.target.value})} required />
                                    <div className="flex gap-4">
                                        <input placeholder="Price" type="number" className="p-3 border rounded w-1/2" value={newItem.price} onChange={e=>setNewItem({...newItem, price: e.target.value})} required />
                                        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded border border-gray-200 w-1/2 justify-center">
                                            <input type="checkbox" checked={newItem.trackStock} onChange={e=>setNewItem({...newItem, trackStock: e.target.checked})} className="w-5 h-5 text-purple-600 rounded"/>
                                            <span className="font-bold text-gray-700 text-sm">Stock?</span>
                                        </div>
                                    </div>
                                </div>
                                
                                {newItem.trackStock && (
                                    <input placeholder="Initial Stock Quantity" type="number" className="w-full p-3 border rounded" value={newItem.stock} onChange={e=>setNewItem({...newItem, stock: e.target.value})} required />
                                )}

                                <input placeholder="Description" className="w-full p-3 border rounded" value={newItem.description} onChange={e=>setNewItem({...newItem, description: e.target.value})} />
                                
                                {/* 🟢 MEDIA GALLERY SECTION */}
                                <div className="mt-6 border p-4 rounded-xl bg-gray-50">
                                    <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3 flex items-center"><ImageIcon size={16} className="mr-2"/> Media Gallery (Max 6)</h4>
                                    
                                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
                                        {/* Existing Media Thumbnails */}
                                        {newItem.media?.map((m, idx) => (
                                            <div key={idx} className="relative group/media aspect-square bg-white rounded-lg border overflow-hidden">
                                                {m.type === 'video' ? (
                                                    <video src={m.url} className="w-full h-full object-cover" muted />
                                                ) : (
                                                    <img src={m.url} className="w-full h-full object-cover" />
                                                )}
                                                <button 
                                                    type="button" 
                                                    onClick={() => removeMedia(idx)}
                                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover/media:opacity-100 transition"
                                                >
                                                    <X size={12}/>
                                                </button>
                                                {m.type === 'video' && <div className="absolute bottom-1 right-1 bg-black/50 text-white p-1 rounded"><Video size={12}/></div>}
                                            </div>
                                        ))}
                                        
                                        {/* Add Media Button (if < 6) */}
                                        {(newItem.media?.length || 0) < 6 && (
                                            <div className="aspect-square border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-indigo-500 hover:text-indigo-500 transition cursor-pointer relative">
                                                <Plus size={24}/>
                                                <span className="text-[10px] font-bold mt-1">Add</span>
                                                {/* Hidden File Input covering the area */}
                                                <input 
                                                    type="file" 
                                                    accept="image/*,video/*" 
                                                    onChange={(e) => addMediaToItem(e)} 
                                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* URL Input Fallback */}
                                    <div className="flex flex-wrap gap-2 justify-end">
                                        <input 
                                            placeholder="Or paste image/video URL..." 
                                            className="flex-grow p-2 text-sm border rounded"
                                            value={mediaInputValue}
                                            onChange={e=>setMediaInputValue(e.target.value)}
                                        />
                                        <button 
                                            type="button" 
                                            onClick={() => addMediaToItem()} 
                                            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 rounded text-xs font-bold"
                                        >
                                            Add URL
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-2">* Supports Images & Short Videos. Local uploads are converted for prototype (limit 500KB).</p>
                                </div>

                                {/* 🟢 NEW HEADER LOCATION */}
                                <div className="mt-6">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-bold text-gray-700 uppercase tracking-wide">Characteristics (Variants & Filters)</span>
                                            <button 
                                                type="button"
                                                onClick={handleAiSortCharacteristics} 
                                                className="flex items-center text-xs bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-full font-bold hover:bg-indigo-200 transition shadow-sm"
                                                title="Smartly reorder characteristics for better menu traversal"
                                            >
                                                <Wand2 size={12} className="mr-1.5"/> AI Sort Order
                                            </button>
                                        </div>
                                    </div>
                                    {/* 🟢 EXPLANATION TEXT */}
                                    <p className="text-xs text-gray-500 italic mb-3">
                                        Note: The order of characteristics below determines the navigation flow in the "Browse Menu". 
                                        Drag rows to reorder. Changes will apply to ALL items on save.
                                    </p>
                                </div>

                                {/* 🟢 QUICK ADD BUTTONS */}
                                <div className="mb-4 flex flex-wrap gap-2">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide mr-2 flex items-center"><Sparkles size={14} className="mr-1"/> Quick Add:</span>
                                    {Object.keys(knownAttributes).map(attr => (
                                        <button 
                                            key={attr}
                                            type="button" 
                                            onClick={() => quickAddCharacteristic(attr)}
                                            className="px-3 py-1 bg-purple-50 text-purple-700 text-xs font-bold rounded-full border border-purple-200 hover:bg-purple-100 transition"
                                        >
                                            + {capitalize(attr)}
                                        </button>
                                    ))}
                                </div>
                                
                                {/* 🟢 AI SETUP MODAL */}
                                {showAiModal && (
                                    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                                        <div className="bg-white p-6 rounded-2xl w-full max-w-sm shadow-2xl relative">
                                            <button onClick={() => setShowAiModal(false)} className="absolute top-4 right-4 text-gray-400"><X size={20}/></button>
                                            <h3 className="font-bold text-lg mb-4">AI Store Setup</h3>
                                            <p className="text-sm text-gray-500 mb-4">Enter your store type (e.g., "Shoe Store", "Sushi Restaurant") to auto-generate characteristics.</p>
                                            <input 
                                                placeholder="Store Type..." 
                                                className="w-full p-3 border rounded-lg mb-4"
                                                value={aiStoreType}
                                                onChange={e=>setAiStoreType(e.target.value)}
                                            />
                                            <button 
                                                onClick={handleAiStoreSetup} 
                                                disabled={aiLoading || !aiStoreType}
                                                className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg shadow-lg hover:bg-indigo-700 disabled:bg-gray-300 flex justify-center items-center"
                                            >
                                                {aiLoading ? <Loader2 className="animate-spin mr-2"/> : <Wand2 className="mr-2"/>} Generate
                                            </button>
                                        </div>
                                    </div>
                                )}
                                
                                <div className="border-t border-gray-200 pt-4">
                                    {newItem.characteristics.map((char, idx) => {
                                        // 🟢 SMART CONTEXT PRESETS
                                        // 1. Gather all values from *other* characteristics to detect context (e.g. 'shoes')
                                        const contextKeywords = newItem.characteristics
                                            .filter((_, i) => i !== idx)
                                            .flatMap(c => c.values.map(v => normalize(v)));

                                        // 2. Default to global presets
                                        let smartSuggestions = GLOBAL_PRESETS[normalize(char.name)] || [];

                                        // 3. If context matches, override with specific presets
                                        const contextMap = CONTEXT_PRESETS[normalize(char.name)];
                                        if (contextMap) {
                                            for (const keyword of contextKeywords) {
                                                if (contextMap[keyword]) {
                                                    smartSuggestions = contextMap[keyword];
                                                    break; // Found a match, stop looking
                                                }
                                            }
                                        }
                                        
                                        const learned = Array.from(knownAttributes[normalize(char.name)]?.values || []);
                                        const allSuggestions = Array.from(new Set([...smartSuggestions, ...learned]));

                                        return (
                                        <div 
                                            key={idx} 
                                            className={`flex flex-col gap-2 mb-3 p-3 rounded border transition-colors ${char.isLead ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'} ${draggedCharIndex === idx ? 'opacity-50 border-dashed border-purple-500' : ''}`} 
                                            ref={activeValueDropdown === idx ? dropdownRef : null}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, idx)}
                                            onDragOver={handleDragOver}
                                            onDrop={(e) => handleDrop(e, idx)}
                                        >
                                            {char.isLead && <div className="text-xs text-amber-700 font-bold flex items-center mb-1"><Star size={10} className="mr-1 fill-amber-600"/> Lead Characteristic (Menu starts here)</div>}
                                            <div className="flex gap-2 items-start relative">
                                                {/* 🟢 DRAG HANDLE */}
                                                <div className="cursor-grab text-gray-400 mt-2 hover:text-gray-600" title="Drag to reorder"><GripVertical size={20}/></div>

                                                {/* 🟢 NAME INPUT (With Fuzzy Typo Correction) */}
                                                <div className="w-1/3 relative">
                                                    <input 
                                                        placeholder="Name (e.g. Size)" 
                                                        value={char.name} 
                                                        onChange={e=>updateCharacteristicName(idx, e.target.value)} 
                                                        className={`w-full p-2 border rounded ${typoSuggestions?.index === idx ? 'border-amber-400 ring-2 ring-amber-100' : ''}`}
                                                    />
                                                    
                                                    {/* 🟢 TYPO SUGGESTION DROPDOWN */}
                                                    {typoSuggestions?.index === idx && (
                                                        <div className="absolute top-full left-0 w-full z-50 mt-1 animate-fade-in">
                                                            <button 
                                                                type="button"
                                                                onClick={() => applyTypoCorrection(idx, typoSuggestions.suggestion)}
                                                                className="bg-amber-50 text-amber-800 text-xs font-bold px-3 py-2 rounded-lg shadow-lg border border-amber-200 flex items-center hover:bg-amber-100 w-full text-left"
                                                            >
                                                                <Lightbulb size={12} className="mr-2"/>
                                                                Did you mean "{typoSuggestions.suggestion}"?
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* 🟢 VALUES INPUT WITH DROPDOWN */}
                                                <div className="w-1/3 relative group/dropdown">
                                                    <div className="relative">
                                                        <input 
                                                            placeholder="Value" 
                                                            value={char.values[0] || ''} 
                                                            onChange={e=>toggleCharacteristicValue(idx, e.target.value)} 
                                                            className="w-full p-2 border rounded pr-8"
                                                            onFocus={() => setActiveValueDropdown(idx)}
                                                        />
                                                        <button 
                                                            type="button"
                                                            onClick={() => setActiveValueDropdown(activeValueDropdown === idx ? null : idx)}
                                                            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-purple-600"
                                                        >
                                                            <ChevronDown size={16} />
                                                        </button>
                                                    </div>

                                                    {/* 🟢 DROPDOWN MENU */}
                                                    {activeValueDropdown === idx && (
                                                        <div className="absolute top-full left-0 w-full bg-white border border-gray-200 shadow-xl rounded-lg z-50 mt-1 max-h-48 overflow-y-auto">
                                                            {allSuggestions.map(sug => {
                                                                const isSelected = char.values.map(v => normalize(v)).includes(normalize(sug));
                                                                return (
                                                                    <button
                                                                        key={sug}
                                                                        type="button"
                                                                        onClick={() => toggleCharacteristicValue(idx, sug)}
                                                                        className={`w-full text-left px-3 py-2 text-sm flex justify-between items-center hover:bg-purple-50 transition ${isSelected ? 'text-purple-700 font-bold bg-purple-50' : 'text-gray-700'}`}
                                                                    >
                                                                        {sug}
                                                                        {isSelected && <Check size={14} className="text-purple-600"/>}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                                
                                                {/* 🟢 TOGGLES */}
                                                <div className="flex flex-col gap-1 w-1/4 justify-center">
                                                    <label className="flex items-center text-xs text-gray-600 cursor-pointer">
                                                        <input type="checkbox" checked={char.isCategory} onChange={e=>updateCharacteristicCategory(idx, e.target.checked)} className="mr-1"/>
                                                        Use as Filter?
                                                    </label>
                                                    
                                                    {/* 🟢 MOVE TO TOP / MAKE LEAD BUTTON */}
                                                    {!char.isLead && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => updateCharacteristicLead(idx, true)}
                                                            className="flex items-center text-xs text-gray-400 hover:text-amber-600 font-bold mt-1"
                                                        >
                                                            <ArrowUp size={10} className="mr-1"/> Make Lead
                                                        </button>
                                                    )}
                                                </div>

                                                <button type="button" onClick={() => removeCharacteristic(idx)} className="text-red-500 p-2"><X size={16}/></button>
                                            </div>
                                        </div>
                                    );
                                    })}
                                    <button type="button" onClick={addCharacteristicToNewItem} className="text-sm text-purple-600 font-bold hover:underline">+ Add Characteristic</button>
                                </div>

                                {/* 🟢 BUTTONS FIXED: Normal Size */}
                                <div className="flex gap-4 mt-4">
                                    <button type="submit" disabled={isAddingItem} className="bg-gray-900 text-white font-bold py-2 px-6 rounded hover:bg-black transition w-auto shadow-md">
                                        {editingIndex !== null ? "Update Item" : "Add Draft"}
                                    </button>
                                    {editingIndex !== null && (
                                        <button type="button" onClick={handleCancelEdit} className="bg-gray-300 text-gray-800 font-bold py-2 px-6 rounded hover:bg-gray-400 transition shadow-md">
                                            Cancel
                                        </button>
                                    )}
                                </div>
                            </form>
                                </>
                            )}


                            {/* 🟢 1. DASHBOARD: CREATED ITEMS LIST - ENHANCED */}
                            <div className="mt-8 border-t-4 border-gray-800 pt-6">
                                <h3 className="text-xl font-bold mb-4 flex items-center text-gray-800"><ListOrdered className="mr-2"/> Created Drafts (Unsaved)</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                    {dashboardMenuItems.map((item, index) => (
                                        <div key={index} className="bg-slate-800 text-white p-4 rounded-xl shadow-lg flex justify-between items-start group border border-slate-700 w-full max-w-[520px] mx-auto">
                                            <div className="flex items-start gap-3">
                                                {/* 🟢 ITEM THUMBNAIL */}
                                                <img src={item.image} className="w-16 h-16 rounded-lg object-cover border border-slate-600 bg-slate-700" onError={(e)=>{e.currentTarget.src="https://placehold.co/64?text=IMG"}} />
                                                <div>
                                                    <span className="font-bold block text-lg">{item.name}</span>
                                                    <div className="flex items-center gap-2 mb-2">
                                                    <span className={`text-xs block ${item.trackStock && isLowStockItem(item) ? 'text-red-300 font-bold' : 'text-slate-400'}`}>
                                                        {item.trackStock ? `Stock: ${item.stock}` : 'Unlimited Stock'}
                                                    </span>
                                                    {item.trackStock && isLowStockItem(item) && (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200">
                                                            Low Stock
                                                        </span>
                                                    )}
                                                </div>
                                                    {/* 🟢 CHARACTERISTIC TAGS */}
                                                    <div className="flex flex-wrap gap-1">
                                                        {item.characteristics?.map(c => (
                                                            <span key={c.name} className="px-2 py-0.5 text-[10px] uppercase font-bold text-slate-300 bg-slate-700 rounded border border-slate-600">
                                                                {c.values.join(', ')}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => handleCloneItem(index)} className="text-emerald-400 hover:text-emerald-300 p-1" title="Clone"><Layers size={18}/></button>
                                                <button onClick={() => handleEditItem(index)} className="text-blue-400 hover:text-blue-300 p-1"><Edit size={18}/></button>
                                                <button onClick={() => handleLocalDeleteByIndex(index)} className="text-red-400 hover:text-red-300 p-1"><Trash2 size={18}/></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            
                            {/* 🟢 SAVE BUTTON FIXED: Normal Size & Aligned Right */}
                            {hasUnsavedChanges && (
                                <div className="mt-8 flex justify-end">
                                    <button onClick={handleSaveChanges} className="bg-green-600 text-white font-bold py-3 px-8 rounded shadow-lg animate-pulse hover:bg-green-700 transition">
                                        Save Changes to Menu
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    if (!isAppReady) return <div className="flex justify-center items-center h-screen text-purple-600 font-bold"><Loader2 className="animate-spin mr-3"/> Loading...</div>;

    return (
        <div className="min-h-screen w-full bg-gray-100 font-sans flex flex-col overflow-x-hidden">
            {/* (Sidebar/Mobile Nav omitted for brevity - Standard implementation remains) */}
            <OrderStatusMessage status={orderStatus} />
            <div className="hidden md:flex bg-white shadow-xl p-6 border-r fixed top-0 left-0 h-full flex-col space-y-6 z-10 w-[140px] lg:w-[180px]">
                <div className="text-center py-4"><h1 className="text-3xl font-extrabold text-purple-700 font-serif">Saffron</h1><h2 className="text-sm text-gray-500">The Table</h2></div>
                <div className="flex flex-col space-y-6 flex-grow">
                    <NavButton sectionName="home" label="Home" IconComponent={Home} />
                    <NavButton sectionName="menu" label={labels.menu} IconComponent={CatalogIcon} />
                    <NavButton sectionName="cart" label={labels.cart} IconComponent={ShoppingCart} count={cartItems.length} />
                    {cartItems.length>0 && activeSection !== 'dashboard' && <NavButton sectionName="checkout" label="Checkout" IconComponent={DollarSign} />}
                </div>
                <div className="pt-6 border-t border-gray-200"><NavButton sectionName="dashboard" label="Dashboard" IconComponent={ChefHat} count={orders.length} isOwner={true} /></div>
            </div>
            
            <main className={`flex-grow p-4 md:p-8 md:pl-[140px] lg:pl-[180px] mt-16 md:mt-0 w-full max-w-full ${activeSection === 'dashboard' ? 'overflow-x-auto' : 'overflow-x-hidden'}`}>
                <div style={{ display: activeSection === 'home' ? 'block' : 'none' }}>{renderHome()}</div>
                <div style={{ display: activeSection === 'menu' ? 'block' : 'none' }}>{renderMenu()}</div>
                <div style={{ display: activeSection === 'cart' ? 'block' : 'none' }}>{renderCart()}</div>
                <div style={{ display: activeSection === 'checkout' ? 'block' : 'none' }}>{renderCheckout()}</div>
                {/* ⚠️ SAFETY: Only render dashboard if active */}
                {activeSection === 'dashboard' && (isOwner ? renderDashboard() : <OwnerLogin onLogin={handleOwnerSignIn} />)}
            </main>
            
            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t shadow-2xl z-20 flex justify-around h-16 items-center">
                <MobileNavButton sectionName="home" label="Home" IconComponent={Home} />
                <MobileNavButton sectionName="menu" label={labels.menu} IconComponent={CatalogIcon} />
                <MobileNavButton sectionName="cart" label={labels.cart} IconComponent={ShoppingCart} count={cartItems.length} />
                <MobileNavButton sectionName="dashboard" label="Dashboard" IconComponent={ChefHat} />
            </div>

            {/* 🟢 STANDARD VARIANT MODAL (Used when clicking "Add to Cart" on grid items that have options but didn't trigger visual search) */}
            {catalogPreviewGroup && (
                <CatalogItemPreviewModal
                    item={catalogPreviewGroup.item}
                    variantsCount={catalogPreviewGroup.variants.length}
                    onClose={() => setCatalogPreviewGroup(null)}
                    onAddToCart={() => {
                        const g = catalogPreviewGroup;
                        if (!g) return;
                        setCatalogPreviewGroup(null);
                        if (g.variants.length === 1) {
                            handleItemClick(g.variants[0]);
                        } else {
                            setCatalogIsolateItems(g.variants);
                            setCatalogIsolateTerm(g.item.name);
                        }
                    }}
                />
            )}

            {selectedItemForVariant && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl relative">
                        <button onClick={()=>setSelectedItemForVariant(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X/></button>
                        <h3 className="font-bold text-xl mb-1">{selectedItemForVariant.name}</h3>
                        <p className="text-gray-500 text-sm mb-6">${selectedItemForVariant.price.toFixed(2)}</p>
                        <div className="space-y-4 mb-6">
                            {selectedItemForVariant.characteristics?.filter(c => c.values.length > 1).map(char => (
                                <div key={char.name}>
                                    <p className="font-bold text-sm mb-2">{toTitleCase(char.name)}</p>
                                    <div className="flex flex-wrap gap-2">
                                        {char.values.map(val => (
                                            <button 
                                                key={val}
                                                onClick={() => setCurrentVariantSelections(prev => ({...prev, [char.name]: val}))}
                                                className={`px-4 py-2 rounded-lg text-sm border transition ${currentVariantSelections[char.name] === val ? 'bg-purple-600 text-white border-purple-600 shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:border-purple-300'}`}
                                            >
                                                {val}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button onClick={() => addToCart(selectedItemForVariant, currentVariantSelections)} className="w-full bg-purple-600 text-white font-bold py-3 rounded-xl shadow-lg hover:bg-purple-700 transition transform hover:scale-[1.02]">Add to Cart</button>
                    </div>
                </div>
            )}
        </div>
    );
}

// 🟢 WRAP WITH GLOBAL ERROR BOUNDARY
export default function AppWrapper() {
    return ( <GlobalErrorBoundary><AppContent /></GlobalErrorBoundary> );
}