import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChefHat, Utensils, Home, BookOpen, ShoppingCart, Plus, Minus, XCircle, DollarSign, ListOrdered, Loader2, CheckCheck, CreditCard, MapPin, Phone, Mail, AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

// --- FIREBASE IMPORTS & SETUP ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import {
    getFirestore,
    collection,
    addDoc,
    query,
    onSnapshot,
    serverTimestamp,
    setLogLevel,
    doc, // Added for updating/deleting
    updateDoc, // Added for updating status
    deleteDoc // Added for "Picked up" button
} from 'firebase/firestore';

// ====================================================================================
// CRITICAL: FIREBASE CONFIGURATION (DO NOT MODIFY GLOBAL VARIABLE CHECK)
// ====================================================================================

// Retrieve globals from Canvas environment or default to empty/null if running locally.
const canvasFirebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const canvasInitialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// If running locally, you must provide your config here:
const firebaseConfig = Object.keys(canvasFirebaseConfig).length > 0
    ? canvasFirebaseConfig
    : {
          // 🚀 FIX: Placeholder values to ensure initialization. REPLACE THESE if running outside Canvas.
          // Your current config: saffron-41b76
          apiKey: "AIzaSyCZjRhhYlse6zb6e0z729vXEFyIifKOEgM",
          authDomain: "saffron-41b76.firebaseapp.com",
          projectId: "saffron-41b76", // THIS IS CRITICAL FOR FIRESTORE
          storageBucket: "saffron-41b76.appspot.com",
          messagingSenderId: "1234567890",
          appId: "1:1234567890:web:abcdef1234567890",
      };

const initialAuthToken = canvasInitialAuthToken;
setLogLevel('debug'); // Enable Firestore logging

// --- Gemini API Constants ---
const apiKey = ""; // Leave as empty string for Canvas execution or replace with your key
const LLM_MODEL = "gemini-2.5-flash-preview-05-20";

// --- TYPE DEFINITIONS for TypeScript Safety ---

interface MenuItem {
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
    status: string; // This will be 'Pending Payment/Unpaid' or 'Done'
    payment: { method: string; transactionId: string };
    timestamp: FirestoreTimestamp | null;
}

type AiResult = {
    dishName: string;
    type: 'description' | 'pairing' | 'error';
    text: string;
} | null;

interface OrderAiResult {
    summary: string;
    actions: string[];
}

// Mock Menu Data (Typed)
const menuItems: MenuItem[] = [
    { name: 'Kabab Koobideh', description: 'Two skewers of seasoned ground meat, grilled to perfection, served with saffron rice.', price: 20.00, image: 'https://placehold.co/192x192/4F46E5/FFFFFF?text=Kabab' },
    { name: 'Ghormeh Sabzi', description: 'A rich and savory herb stew with kidney beans, dried lime, and lamb shank.', price: 18.50, image: 'https://placehold.co/192x192/8B5CF6/FFFFFF?text=Sabzi' },
    { name: 'Fesenjan', description: 'A delightful, slightly sweet and sour stew of chicken, ground walnuts, and pomegranate paste.', price: 22.00, image: 'https://placehold.co/192x192/6D28D9/FFFFFF?text=Fesenjan' },
    { name: 'Tahdig', description: 'The crispy, golden layer of rice from the bottom of the pot, often considered a delicacy.', price: 8.00, image: 'https://placehold.co/192x192/A78BFA/FFFFFF?text=Tahdig' },
    { name: 'Barg Kabab', description: 'Thinly sliced lamb or beef tenderloin marinated in lemon juice and onion, grilled on a skewer.', price: 25.00, image: 'https://placehold.co/192x192/8B5CF6/FFFFFF?text=Barg' },
    { name: 'Zereshk Polo', description: 'Steamed rice with bright red barberries and saffron, traditionally served with roasted chicken.', price: 19.00, image: 'https://placehold.co/192x192/4F46E5/FFFFFF?text=Polo' },
];

export default function App() {
    // --- STATE VARIABLES (Typed) ---
    const [activeSection, setActiveSection] = useState('home');
    const [cartItems, setCartItems] = useState<CartItem[]>([]);
    const [db, setDb] = useState<any>(null); // Use 'any' for Firestore instance as it's complex
    const [auth, setAuth] = useState<any>(null); // Use 'any' for Auth instance
    const [userId, setUserId] = useState<string | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [isPlacingOrder, setIsPlacingOrder] = useState(false);
    const [orderStatus, setOrderStatus] = useState<string | null>(null);
    const [isAppReady, setIsAppReady] = useState(false);

    // --- AI State for Menu ---
    const [aiResult, setAiResult] = useState<AiResult>(null);
    const [aiLoading, setAiLoading] = useState(false);

    // --- AI State for Orders (Record<OrderId, Result>) ---
    const [orderAiResult, setOrderAiResult] = useState<Record<string, OrderAiResult>>({});
    const [orderAiLoadingId, setOrderAiLoadingId] = useState<string | null>(null);

    const [customerInfo, setCustomerInfo] = useState({
        name: '', email: '', phone: '', instructions: ''
    });

    // 1. Initialize Firebase and Handle Auth 
    useEffect(() => {
        let cleanup: (() => void) | undefined;
        
        // --- FIX 1: SIMPLIFY VALIDATION FOR LOCAL RUNNING ---
        // Changed validation to check if project ID is present, which it should be locally.
        const isConfigValid = firebaseConfig && Object.keys(firebaseConfig).length > 0 && firebaseConfig.projectId;

        if (isConfigValid) {
            try {
                const app = initializeApp(firebaseConfig);
                const firestore = getFirestore(app);
                setDb(firestore);

                const firebaseAuth = getAuth(app);
                setAuth(firebaseAuth);

                const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (user) => {
                    if (!user) {
                        try {
                            if (initialAuthToken) {
                                await signInWithCustomToken(firebaseAuth, initialAuthToken);
                            } else {
                                await signInAnonymously(firebaseAuth);
                            }
                        } catch (e) {
                            // FIX: Added fail-safe to set a temporary userId if Auth fails.
                            console.error("Authentication failed during sign-in:", e);
                            setUserId(crypto.randomUUID()); 
                        }
                    }

                    // Ensure userId is set, either from auth or a random UUID fallback
                    const currentUserId = firebaseAuth.currentUser?.uid || crypto.randomUUID();
                    setUserId(currentUserId);

                    if (firestore) {
                        setIsAppReady(true);
                    }
                });

                cleanup = () => unsubscribeAuth();
            } catch (error) {
                console.error("Firebase initialization failed. Check your config object structure:", error);
                setDb(null);
                setUserId(crypto.randomUUID());
                setIsAppReady(true);
            }
        } else {
            console.warn("Firebase config is missing or invalid. Database features will be disabled.");
            setDb(null);
            setUserId(crypto.randomUUID());
            setIsAppReady(true);
        }

        return cleanup;
    }, []);

    // 2. Real-time Order Tracking (Owner Dashboard)
    useEffect(() => {
        // Only run if DB is initialized and App is ready
        if (db && userId && isAppReady && appId) {
            // Public path for collaborative data: /artifacts/{appId}/public/data/orders
            const ordersPath = `artifacts/${appId}/public/data/orders`;

            // NOTE: orderBy is intentionally omitted to avoid requiring index creation
            const q = query(collection(db, ordersPath));

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const fetchedOrders: Order[] = [];
                snapshot.forEach((doc) => {
                    fetchedOrders.push({ id: doc.id, ...(doc.data() as Omit<Order, 'id'>) });
                });
                
                // Client-side sorting by timestamp (newest first)
                fetchedOrders.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
                setOrders(fetchedOrders);
            }, (error) => {
                // This handles the previous LISTEN 400 error (Permission Denied for read)
                console.error("Error fetching orders (check read permissions):", error);
                if (error && error.message.includes('permission-denied')) {
                    setOrderStatus('db_permission_error_read');
                    setTimeout(() => setOrderStatus(null), 5000);
                }
            });

            return () => unsubscribe();
        }
    }, [db, userId, isAppReady]);

    // 3. GEMINI API Logic (General Text Output) ---
    const callGeminiApi = useCallback(async (systemPrompt: string, userQuery: string, retries = 3): Promise<string> => {
        
        // This check handles cases where the user has not replaced the placeholder key
        if (apiKey === "YOUR_GEMINI_API_KEY_HERE" || apiKey === "") {
            return "AI feature disabled: Please provide a valid Gemini API key.";
        }

        setAiLoading(true);
        setAiResult(null);

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
        };

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();
                const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

                if (text) {
                    setAiLoading(false);
                    return text;
                }
                throw new Error("API response text missing.");

            } catch (error) {
                console.error(`Attempt ${attempt + 1} failed:`, error);
                if (attempt < retries - 1) {
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise(res => setTimeout(res, delay));
                } else {
                    setAiLoading(false);
                    return "Sorry, the AI service is currently unavailable. Please try again later.";
                }
            }
        }
        setAiLoading(false);
        return "An unexpected error occurred.";
    }, [apiKey]);

    const generateDescription = useCallback(async (item: MenuItem) => {
        if (aiLoading) return;
        setAiResult({ dishName: item.name, type: 'description', text: "" }); // Reset result for current dish
        const systemPrompt = "You are a poetic, high-end restaurant copywriter specializing in Persian cuisine. Generate a single, captivating, and sensory description (max 2 sentences) for a menu item. Do not mention price or ingredients directly in the response, focus purely on the experience.";
        const userQuery = `Generate an alternative description for the dish: ${item.name} which is currently described as: "${item.description}"`;
        const resultText = await callGeminiApi(systemPrompt, userQuery);

        if (resultText && !resultText.includes("AI feature disabled")) {
            setAiResult({ dishName: item.name, type: 'description', text: resultText });
        } else if (resultText.includes("AI feature disabled")) {
            setAiResult({ dishName: item.name, type: 'error', text: resultText });
        }
    }, [aiLoading, callGeminiApi]);

    const generatePairing = useCallback(async (item: MenuItem) => {
        if (aiLoading) return;
        setAiResult({ dishName: item.name, type: 'pairing', text: "" }); // Reset result for current dish
        const systemPrompt = "You are a sommelier and culinary expert. Suggest one ideal pairing (either a drink like Doogh or a side dish like Salad Shirazi) for the following Persian dish and provide a single, short justification why it pairs well (max 2 sentences). Start the response with the suggested item name in bold, followed by the justification. Use Markdown for bolding.";
        const userQuery = `Suggest a pairing for the Persian dish: ${item.name} which has the description: "${item.description}"`;
        const resultText = await callGeminiApi(systemPrompt, userQuery);

        if (resultText && !resultText.includes("AI feature disabled")) {
            setAiResult({ dishName: item.name, type: 'pairing', text: resultText });
        } else if (resultText.includes("AI feature disabled")) {
            setAiResult({ dishName: item.name, type: 'error', text: resultText });
        }
    }, [aiLoading, callGeminiApi]);

    // 4. GEMINI API Logic (Structured JSON Output for Orders) ---
    const generateOrderSummaryAndActions = useCallback(async (order: Order, retries = 3) => {
        if (orderAiLoadingId === order.id) return;

        if (apiKey === "YOUR_GEMINI_API_KEY_HERE" || apiKey === "") {
            setOrderAiResult(prev => ({
                ...prev,
                [order.id]: {
                    summary: "AI feature disabled: Provide a valid Gemini API key.",
                    actions: ["Manually review order details."]
                }
            }));
            return;
        }

        setOrderAiLoadingId(order.id);
        const orderDetails = order.items.map(item => `${item.quantity}x ${item.name}`).join('; ');
        const userQuery = `Analyze the following restaurant order and provide a concise summary and key action items for the kitchen. Order details: ${orderDetails}. Customer name: ${order.customerName}. Special instructions: ${order.deliveryInstructions || 'None'}`;
        const systemPrompt = "You are a professional kitchen manager. Your task is to analyze a raw order list and convert it into a concise summary for front-of-house staff (one short paragraph) and a list of urgent, practical action items for the kitchen chef. The output must be in JSON format.";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: [{ "google_search": {} }], // Adding search grounding for context on dishes, though primary use is JSON structure
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        "summary": { "type": "STRING", description: "A one-sentence summary of the order for front-of-house." },
                        "actions": {
                            "type": "ARRAY",
                            "items": { "type": "STRING" },
                            description: "A list of critical, action-oriented instructions for the kitchen."
                        }
                    },
                    "propertyOrdering": ["summary", "actions"]
                }
            }
        };

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                const result = await response.json();
                const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

                if (jsonText) {
                    const parsedJson = JSON.parse(jsonText) as OrderAiResult;
                    setOrderAiResult(prev => ({
                        ...prev,
                        [order.id]: {
                            summary: parsedJson.summary,
                            actions: parsedJson.actions
                        }
                    }));
                    setOrderAiLoadingId(null);
                    return;
                }
                throw new Error("API response text missing or invalid JSON.");

            } catch (error) {
                console.error(`Attempt ${attempt + 1} failed:`, error);
                if (attempt < retries - 1) {
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise(res => setTimeout(res, delay));
                } else {
                    setOrderAiLoadingId(null);
                    setOrderAiResult(prev => ({
                        ...prev,
                        [order.id]: {
                            summary: "Failed to generate AI summary: Service unavailable.",
                            actions: ["Check API connection.", "Manually review order details."]
                        }
                    }));
                    return;
                }
            }
        }
        setOrderAiLoadingId(null);
    }, [orderAiLoadingId, apiKey]);

    // 5. Order Logic
    const handleAddToCart = (item: MenuItem) => {
        setCartItems(prevItems => {
            const existingItem = prevItems.find(cartItem => cartItem.name === item.name);
            if (existingItem) {
                return prevItems.map(cartItem =>
                    cartItem.name === item.name ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
                );
            }
            return [...prevItems, { ...item, quantity: 1 }];
        });
    };

    const updateQuantity = (itemName: string, newQuantity: number) => {
        if (newQuantity <= 0) {
            setCartItems(prevItems => prevItems.filter(item => item.name !== itemName));
        } else {
            setCartItems(prevItems => prevItems.map(item =>
                item.name === itemName ? { ...item, quantity: newQuantity } : item
            ));
        }
    };

    const calculateTotal = (): number => {
        return cartItems.reduce((total, item) => total + (item.price * item.quantity), 0);
    };

    const calculateTotalFormatted = () => calculateTotal().toFixed(2);


    const placeOrder = async (e: React.FormEvent) => {
        e.preventDefault();

        if (cartItems.length === 0) {
            setOrderStatus('validation_empty_cart');
            setTimeout(() => setOrderStatus(null), 3000);
            return;
        }
        if (!customerInfo.name || !customerInfo.phone) {
            setOrderStatus('validation_missing_fields');
            setTimeout(() => setOrderStatus(null), 3000);
            return;
        }
        
        if (isPlacingOrder) return; 

        // CRITICAL: Check if DB is available (This prevents the app from crashing on unconfigured setups)
        // --- FIX 2: REMOVED PROJECT ID CHECK ---
        // The check was: firebaseConfig.projectId !== "saffron-41b76"
        // This fails when running locally because your local config *has* the correct ID.
        // The check now ensures the config object has *some* project ID.
        const isConfigured = Object.keys(firebaseConfig).length > 0 && firebaseConfig.projectId;
        
        if (!isAppReady || !db || !userId || !appId || !isConfigured) {
            console.error("CRITICAL: Order attempted, but Firestore DB is not initialized or configured.");
            setOrderStatus('config_missing_db');
            setIsPlacingOrder(false);
            setTimeout(() => setOrderStatus(null), 7000);
            return;
        }

        // Start loading and disable button
        setIsPlacingOrder(true);
        setOrderStatus(null);

        try {
            // Path: /artifacts/{appId}/public/data/orders (Public data for the dashboard)
            const ordersPath = `artifacts/${appId}/public/data/orders`;

            const orderData = {
                userId: userId,
                customerName: customerInfo.name,
                customerPhone: customerInfo.phone,
                customerEmail: customerInfo.email || 'N/A',
                deliveryInstructions: customerInfo.instructions || 'None',
                items: cartItems.map(item => ({
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    subtotal: item.price * item.quantity
                })),
                totalAmount: calculateTotal(),
                status: 'Pending Payment/Unpaid', // This is the default "Working On" status
                payment: { method: 'Cash/Pickup (Unpaid)', transactionId: 'N/A' },
                timestamp: serverTimestamp(),
            };

            await addDoc(collection(db, ordersPath), orderData);

            // SUCCESS HANDLERS
            setCartItems([]);
            setCustomerInfo({ name: '', email: '', phone: '', instructions: '' });
            setOrderStatus('success');
            setActiveSection('menu'); 
            
        } catch (error) {
            // This catches the 400 Bad Request error due to Security Rules.
            console.error("Error placing order (check create permissions):", error);
            setOrderStatus('db_permission_error_write');
            
        } finally {
            // CRITICAL FIX: Ensure loading state is ALWAYS reset on completion (success or error)
            setIsPlacingOrder(false); 
            setTimeout(() => setOrderStatus(null), 5000);
        }
    };

    // Helper to render order status box
    const OrderStatusMessage = ({ status }: { status: string | null }) => {
        if (!status) return null;

        let color, text, Icon;

        switch (status) {
            case 'success':
                color = 'bg-green-500';
                text = 'Order placed successfully! Pending payment at pickup/delivery.';
                Icon = CheckCheck;
                break;
            case 'db_permission_error_write':
                color = 'bg-red-500';
                text = 'Operation Failed: Security Rules denied the WRITE/UPDATE operation. (HINT: Check Firestore rules to allow "update" and "delete".)';
                Icon = XCircle;
                break;
            case 'db_permission_error_read':
                color = 'bg-red-500';
                text = 'Dashboard Failed: Security Rules denied the READ operation. (HINT: Check your Firestore Security Rules.)';
                Icon = XCircle;
                break;
            case 'config_missing_db': // Updated explicit status
                color = 'bg-red-600';
                text = 'Order Failed: Firestore config is missing. Please replace the placeholder values in the firebaseConfig object to enable the database.';
                Icon = AlertTriangle;
                break;
            case 'validation_missing_fields':
                color = 'bg-yellow-500';
                text = '⚠️ Please fill in your Full Name and Phone Number to proceed with checkout.';
                Icon = ListOrdered;
                break;
            case 'validation_empty_cart':
                color = 'bg-yellow-500';
                text = '⚠️ Your cart is empty. Please add items before checking out.';
                Icon = ShoppingCart;
                break;
            default:
                return null;
        }

        return (
            <div className={`fixed top-4 right-4 z-50 p-4 rounded-xl text-white font-semibold flex items-center shadow-2xl max-w-sm ${color}`}>
                <Icon className="w-6 h-6 mr-3 flex-shrink-0" />
                <span className="text-sm">{text}</span>
            </div>
        );
    };

    // --- Reusable Navigation Button Component ---
    const NavButton = ({ sectionName, label, IconComponent, count, isOwner = false }: { sectionName: string, label: string, IconComponent: React.ElementType, count?: number, isOwner?: boolean }) => {
        const baseBg = isOwner ? 'bg-gray-800' : 'bg-purple-600';
        const baseHover = isOwner ? 'hover:bg-gray-900' : 'hover:bg-purple-700';
        const ringColor = isOwner ? 'ring-gray-400' : 'ring-purple-400';

        const activeClasses = activeSection === sectionName
            ? `shadow-2xl ring-4 ${ringColor} scale-105 ring-offset-4 ring-offset-gray-100`
            : `${baseHover} shadow-lg`;

        const displayLabel = count !== undefined ? `${label} (${count})` : label;

        return (
            <button
                onClick={() => setActiveSection(sectionName)}
                className={`
                    w-24 h-24 md:w-28 md:h-28 rounded-full flex flex-col items-center justify-center
                    font-semibold text-white text-xs md:text-sm font-sans
                    transition duration-300 transform flex-shrink-0
                    ${baseBg} ${activeClasses}
                `}
            >
                <IconComponent className="mb-1" size={24} />
                <span className="text-center">{displayLabel}</span>
            </button>
        );
    };

    // --- Reusable Mobile Navigation Button Component (Bottom Bar) ---
    const MobileNavButton = ({ sectionName, IconComponent, count = 0, label }: { sectionName: string, IconComponent: React.ElementType, count?: number, label: string }) => {
        const isActive = activeSection === sectionName;
        const colorClass = isActive ? 'text-purple-600' : 'text-gray-500 hover:text-purple-600';

        const isOwner = sectionName === 'dashboard';
        const activeBar = isOwner 
            ? 'border-gray-800' 
            : 'border-purple-600';

        return (
            <button
                onClick={() => setActiveSection(sectionName)}
                className={`flex flex-col items-center p-2 transition-colors duration-200 relative ${colorClass} w-full`}
            >
                {isActive && <div className={`absolute top-0 w-8 h-1 rounded-b-full ${activeBar}`}></div>}
                <IconComponent className="w-6 h-6" />
                {count > 0 && sectionName === 'cart' && ( 
                    <span className="absolute top-1 right-3 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                        {count}
                    </span>
                )}
                <span className="text-[10px] mt-1 font-semibold">{label}</span>
            </button>
        );
    };


    // --- RENDERING SECTIONS ---
    
    // ====================================================================================
    // --- NEW: KITCHEN ORDER TICKET COMPONENT (FOR DASHBOARD) ---
    // ====================================================================================
    const KitchenOrderTicket = ({ order }: { order: Order }) => {
        // We use the `db` and `appId` from the main App component's scope
        const isWorkingOn = order.status === 'Pending Payment/Unpaid';
        const baseClasses = "p-4 shadow-lg rounded-xl transition-all duration-300 transform hover:scale-[1.01] flex flex-col justify-between";

        // Action Handlers
        const updateOrderStatus = useCallback(async (newStatus: string) => {
            try {
                if (!db) { // Added check
                    console.error("Database not initialized");
                    return;
                }
                const orderDocRef = doc(db, `artifacts/${appId}/public/data/orders`, order.id);
                await updateDoc(orderDocRef, {
                    status: newStatus,
                });
            } catch (error: any) { // Modified catch
                console.error("Error updating order status:", error);
                if (error && error.message.includes('permission-denied')) {
                    setOrderStatus('db_permission_error_write'); // Use App's state setter
                }
            }
        }, [order.id, db, appId]); // <-- ADDED db and appId dependencies

        const handlePickUp = useCallback(async () => {
            try {
                if (!db) { // Added check
                    console.error("Database not initialized");
                    return;
                }
                const orderDocRef = doc(db, `artifacts/${appId}/public/data/orders`, order.id);
                await deleteDoc(orderDocRef);
            } catch (error: any) { // Modified catch
                console.error("Error deleting order:", error);
                if (error && error.message.includes('permission-denied')) {
                    setOrderStatus('db_permission_error_write'); // Use App's state setter
                }
            }
        }, [order.id, db, appId]); // <-- ADDED db and appId dependencies


        const handleDoneClick = () => updateOrderStatus('Done'); // Set status to 'Done'
        const handleMoveToWorkingOnClick = () => updateOrderStatus('Pending Payment/Unpaid'); // Set back to original status

        // Button Styling
        const btnClasses = "px-3 py-2 rounded-lg font-semibold transition duration-200 shadow-md flex items-center justify-center text-sm";

        return (
            <div className={`${baseClasses} ${isWorkingOn ? 'bg-amber-50 border-t-4 border-amber-500' : 'bg-green-50 border-t-4 border-green-500'}`}>
                <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-bold text-gray-800">Order #{order.id.substring(0, 8)}</h3>
                    <p className={`text-xs font-medium px-2 py-1 rounded-full ${isWorkingOn ? 'bg-amber-200 text-amber-800' : 'bg-green-200 text-green-800'}`}>
                        {isWorkingOn ? 'WORKING ON' : 'READY'}
                    </p>
                </div>

                <p className="text-xl font-extrabold text-gray-900 mb-1">{order.customerName}</p>
                <p className="text-xs text-gray-500 mb-1">
                    {order.timestamp?.seconds ? new Date(order.timestamp.seconds * 1000).toLocaleString() : 'N/A'}
                </p>
                <p className="text-lg font-bold text-purple-700 mb-3">${order.totalAmount.toFixed(2)}</p>

                <ul className="list-disc pl-5 mb-4 text-gray-700 space-y-1 text-sm">
                    {order.items.map((item, index) => (
                        <li key={index} className="truncate">
                            {item.quantity}x <span className="font-bold">{item.name}</span>
                        </li>
                    ))}
                </ul>
                <p className="text-xs italic text-gray-600 mb-4">Instructions: {order.deliveryInstructions}</p>

                <div className="mt-auto pt-4 border-t border-gray-200">
                    {isWorkingOn ? (
                        // Button for Working On section
                        <button
                            onClick={handleDoneClick}
                            className={`${btnClasses} w-full bg-emerald-600 text-white hover:bg-emerald-700`}
                        >
                            <CheckCheck className="w-5 h-5 mr-2" />
                            Order Done
                        </button>
                    ) : (
                        // Buttons for DONE section
                        <div className="flex space-x-2">
                            <button
                                onClick={handleMoveToWorkingOnClick}
                                className={`${btnClasses} flex-1 bg-sky-100 text-sky-800 hover:bg-sky-200`}
                            >
                                <RefreshCw className="w-4 h-4 mr-1" />
                                Back to Working On
                            </button>
                            <button
                                onClick={handlePickUp}
                                className={`${btnClasses} bg-red-500 text-white hover:bg-red-600`}
                            >
                                <Trash2 className="w-4 h-4" />
                                Picked up
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };
    
    // Order Card Renderer (Used in Dashboard) - THIS IS NOW REPLACED BY KitchenOrderTicket
    // const renderOrderCard = (order: Order) => ( ... ); // <-- Original function is no longer used by renderDashboard

    // Home Section Renderer
    const renderHome = () => (
        <div className="text-center py-16 px-4 bg-purple-50 rounded-2xl shadow-xl">
            <ChefHat className="w-16 h-16 mx-auto mb-4 text-purple-600" />
            <h2 className="text-6xl font-extrabold text-gray-900 font-serif mb-4">
                The Saffron Table
            </h2>
            <p className="text-xl text-gray-600 mb-8 max-w-lg mx-auto">
                Experience the rich flavors and aromatic traditions of authentic Persian cuisine. Order your feast now!
            </p>
            <div className="flex flex-col sm:flex-row justify-center space-y-4 sm:space-y-0 sm:space-x-6">
                <button
                    onClick={() => setActiveSection('menu')}
                    className="bg-purple-600 text-white font-bold py-3 px-8 rounded-full shadow-lg hover:bg-purple-700 transition transform hover:scale-105"
                >
                    View Full Menu
                </button>
                <button
                    onClick={() => setActiveSection('dashboard')}
                    className="bg-gray-800 text-white font-bold py-3 px-8 rounded-full shadow-lg hover:bg-gray-900 transition transform hover:scale-105 flex items-center justify-center"
                >
                    <ChefHat className="w-5 h-5 mr-2" /> Owner Dashboard
                </button>
            </div>

            <div className="mt-12 pt-8 border-t border-purple-200">
                <h3 className="text-2xl font-bold text-gray-800 mb-4">Contact Us</h3>
                <div className="flex justify-center flex-wrap gap-6 text-gray-600">
                    <p className="flex items-center"><MapPin className="w-4 h-4 mr-2 text-purple-600" /> 123 Saffron Lane, Tehrangeles, CA</p>
                    <p className="flex items-center"><Phone className="w-4 h-4 mr-2 text-purple-600" /> (555) 555-SAFR</p>
                    <p className="flex items-center"><Mail className="w-4 h-4 mr-2 text-purple-600" /> orders@saffrontable.com</p>
                </div>
            </div>
        </div>
    );

    // Menu Section Renderer
    const renderMenu = () => (
        <div className="space-y-12">
            <h2 className="text-4xl font-extrabold text-gray-900 font-sans flex items-center">
                <Utensils className="w-8 h-8 mr-3 text-purple-600" />
                The Persian Feast Menu
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                {menuItems.map((item) => (
                    <div key={item.name} className="bg-white rounded-2xl shadow-xl overflow-hidden hover:shadow-2xl transition duration-300 flex flex-col">
                        <img
                            src={item.image}
                            alt={item.name}
                            className="w-full h-48 object-cover object-center"
                            onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.src = `https://placehold.co/400x192/E5E7EB/4B5563?text=${item.name.slice(0, 8)}...`;
                            }}
                        />
                        <div className="p-6 flex flex-col flex-grow">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="text-2xl font-bold text-gray-900 font-serif">{item.name}</h3>
                                <span className="text-xl font-extrabold text-purple-600">${item.price.toFixed(2)}</span>
                            </div>
                            <p className="text-gray-600 text-sm mb-4 flex-grow">{item.description}</p>

                            {/* AI Buttons */}
                            <div className="flex space-x-2 mb-4">
                                <button
                                    onClick={() => generateDescription(item)}
                                    disabled={aiLoading}
                                    className="flex-1 text-xs px-3 py-1 bg-purple-100 text-purple-700 font-semibold rounded-full hover:bg-purple-200 transition disabled:bg-gray-200 disabled:text-gray-600 flex items-center justify-center"
                                >
                                    {aiLoading && aiResult?.dishName === item.name && aiResult?.type === 'description' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <BookOpen className="w-4 h-4 mr-1" />}
                                    {!aiLoading || aiResult?.dishName !== item.name || aiResult?.type !== 'description' ? 'Poetic Description' : 'Loading...'}
                                </button>
                                <button
                                    onClick={() => generatePairing(item)}
                                    disabled={aiLoading}
                                    className="flex-1 text-xs px-3 py-1 bg-purple-100 text-purple-700 font-semibold rounded-full hover:bg-purple-200 transition disabled:bg-gray-200 disabled:text-gray-600 flex items-center justify-center"
                                >
                                    {aiLoading && aiResult?.dishName === item.name && aiResult?.type === 'pairing' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ChefHat className="w-4 h-4 mr-1" />}
                                    {!aiLoading || aiResult?.dishName !== item.name || aiResult?.type !== 'pairing' ? 'Pairing Suggestion' : 'Loading...'}
                                </button>
                            </div>
                            
                            {/* AI Result Display */}
                            {aiResult && aiResult.dishName === item.name && (
                                <div className={`p-3 mt-2 rounded-lg text-sm ${aiResult.type === 'error' ? 'bg-red-100 text-red-800 border-l-4 border-red-500' : 'bg-green-50 text-green-800 border-l-4 border-green-500'}`}>
                                    {aiResult.type === 'error' && <AlertTriangle className="w-4 h-4 mr-2 inline" />}
                                    <div dangerouslySetInnerHTML={{ __html: aiResult.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                                </div>
                            )}

                            {/* Add to Cart Button */}
                            <button
                                onClick={() => handleAddToCart(item)}
                                className="mt-4 w-full bg-purple-600 text-white font-bold py-3 rounded-xl shadow-lg hover:bg-purple-700 transition transform hover:scale-[1.01] flex items-center justify-center"
                            >
                                <ShoppingCart className="w-5 h-5 mr-2" />
                                Add to Cart
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    // Cart Section Renderer
    const renderCart = () => (
        <div className="space-y-8 max-w-4xl mx-auto">
            <h2 className="text-4xl font-extrabold text-gray-900 font-sans flex items-center">
                <ShoppingCart className="w-8 h-8 mr-3 text-purple-600" />
                Your Order Basket
            </h2>

            {cartItems.length === 0 ? (
                <div className="text-center p-12 bg-gray-50 rounded-2xl shadow-inner">
                    <p className="text-xl text-gray-500 font-semibold">Your cart is currently empty. <span className="block text-sm font-normal pt-2">Head to the menu to start your Persian feast!</span></p>
                    <button
                        onClick={() => setActiveSection('menu')}
                        className="mt-6 bg-purple-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:bg-purple-700 transition"
                    >
                        View Menu
                    </button>
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-xl divide-y divide-purple-100 p-4">
                        {cartItems.map(item => (
                            <div key={item.name} className="flex items-center justify-between py-4">
                                <div className="flex items-center space-x-4">
                                    <img
                                        src={item.image}
                                        alt={item.name}
                                        className="w-16 h-16 rounded-lg object-cover"
                                        onError={(e) => {
                                            e.currentTarget.onerror = null;
                                            e.currentTarget.src = `https://placehold.co/64x64/E5E7EB/4B5563?text=Dish`;
                                        }}
                                    />
                                    <div>
                                        <p className="font-semibold text-lg text-gray-900">{item.name}</p>
                                        <p className="text-sm text-gray-500">${item.price.toFixed(2)} each</p>
                                    </div>
                                </div>
                                
                                <div className="flex items-center space-x-4">
                                    <div className="flex items-center border border-purple-300 rounded-full">
                                        <button
                                            onClick={() => updateQuantity(item.name, item.quantity - 1)}
                                            className="p-2 text-purple-600 hover:bg-purple-50 rounded-l-full transition"
                                        >
                                            <Minus className="w-4 h-4" />
                                        </button>
                                        <span className="px-3 font-semibold text-gray-800">{item.quantity}</span>
                                        <button
                                            onClick={() => updateQuantity(item.name, item.quantity + 1)}
                                            className="p-2 text-purple-600 hover:bg-purple-50 rounded-r-full transition"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => updateQuantity(item.name, 0)}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-full transition"
                                    >
                                        <XCircle className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="bg-purple-50 p-6 rounded-2xl shadow-inner flex justify-between items-center">
                        <p className="text-xl font-bold text-gray-800">Order Subtotal:</p>
                        <p className="text-3xl font-extrabold text-purple-700">${calculateTotalFormatted()}</p>
                    </div>

                    <button
                        onClick={() => setActiveSection('checkout')}
                        className="w-full bg-green-500 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-green-600 transition transform hover:scale-[1.01] flex items-center justify-center text-xl"
                    >
                        <CreditCard className="w-6 h-6 mr-2" />
                        Proceed to Checkout
                    </button>
                </div>
            )}
        </div>
    );

    // Checkout Section Renderer
    const renderCheckout = () => (
        <div className="space-y-8 max-w-xl mx-auto">
            <h2 className="text-4xl font-extrabold text-gray-900 font-sans flex items-center">
                <ListOrdered className="w-8 h-8 mr-3 text-purple-600" />
                Delivery & Payment
            </h2>

            <div className="bg-white p-8 rounded-2xl shadow-xl">
                <form onSubmit={placeOrder} className="space-y-6">
                    <div className="bg-purple-50 p-4 rounded-xl border border-purple-200">
                        <p className="text-lg font-bold text-purple-800 mb-2">Order Summary</p>
                        <div className="flex justify-between text-gray-700 text-sm">
                            <span>{cartItems.length} items</span>
                            <span className="text-xl font-extrabold text-purple-700">${calculateTotalFormatted()}</span>
                        </div>
                    </div>

                    <h3 className="text-xl font-bold text-gray-800 pt-2 border-t border-gray-100">Contact & Delivery</h3>

                    <div className="space-y-4">
                        <input
                            type="text"
                            placeholder="* Full Name"
                            value={customerInfo.name}
                            onChange={(e) => setCustomerInfo(p => ({ ...p, name: e.target.value }))}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500"
                            required
                        />
                        <input
                            type="tel"
                            placeholder="* Phone Number (e.g., 555-123-4567)"
                            value={customerInfo.phone}
                            onChange={(e) => setCustomerInfo(p => ({ ...p, phone: e.target.value }))}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500"
                            required
                        />
                        <input
                            type="email"
                            placeholder="Email (Optional)"
                            value={customerInfo.email}
                            onChange={(e) => setCustomerInfo(p => ({ ...p, email: e.target.value }))}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500"
                        />
                        <textarea
                            placeholder="Delivery Instructions (e.g., House number, street name, no nuts please)"
                            value={customerInfo.instructions}
                            onChange={(e) => setCustomerInfo(p => ({ ...p, instructions: e.target.value }))}
                            rows={3}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500"
                        />
                    </div>

                    <div className="p-4 bg-yellow-100 rounded-xl flex items-start space-x-3">
                        <DollarSign className="w-5 h-5 text-yellow-700 mt-1 flex-shrink-0" />
                        <p className="text-sm text-yellow-800 font-semibold">
                            Payment Method: Cash or Card upon Pickup/Delivery. <br/>
                            <span className="font-normal italic">Your order will be placed in the system as "Pending Payment."</span>
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={isPlacingOrder || cartItems.length === 0}
                        className="w-full bg-purple-600 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-purple-700 transition transform hover:scale-[1.01] disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center text-xl"
                    >
                        {isPlacingOrder ? (
                            <><Loader2 className="animate-spin mr-2 w-6 h-6" /> Placing Order...</>
                        ) : (
                            <><CheckCheck className="w-6 h-6 mr-2" /> Confirm & Place Order</>
                        )}
                    </button>
                </form>
            </div>

            <button
                onClick={() => setActiveSection('cart')}
                className="w-full text-sm text-gray-500 hover:text-purple-600 transition font-medium flex items-center justify-center pt-2"
            >
                &larr; Back to Cart
            </button>
        </div>
    );

    // ====================================================================================
    // --- MODIFIED: Dashboard Section Renderer ---
    // ====================================================================================
    const renderDashboard = () => {
        // Filter orders based on status
        const workingOnOrders = orders.filter(o => o.status === 'Pending Payment/Unpaid');
        const doneOrders = orders.filter(o => o.status === 'Done');

        return (
            <div className="space-y-8">
                {/* This is your original header and info box, unchanged */}
                <h2 className="text-4xl font-extrabold text-gray-900 font-sans flex items-center">
                    <ChefHat className="w-8 h-8 mr-3 text-gray-800" />
                    Kitchen Order Dashboard ({orders.length} Total)
                </h2>
                <div className="p-4 bg-gray-100 rounded-xl shadow-inner">
                    <p className="text-sm font-semibold text-gray-700 mb-2">System Info:</p>
                    <div className="flex flex-wrap text-xs text-gray-600 font-mono space-x-4">
                        <span>App ID: <span className="font-bold text-gray-800">{appId}</span></span>
                        <span>User ID (Current Viewer): <span className="font-bold text-gray-800">{userId?.substring(0, 8) || 'N/A'}...</span></span>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">This is the new real-time kitchen workflow. New orders appear in "Working On".</p>
                    <p className="text-sm text-red-600 mt-3 font-semibold">
                        ⚠️ If no orders appear, ensure your Firestore Security Rules allow `read` access to `artifacts/{appId}/public/data/orders`.
                    </p>
                </div>

                {/* --- NEW: Two-Column Workflow Layout --- */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl mx-auto">
                    {/* --- Working On Column --- */}
                    <div className="bg-white p-5 rounded-xl shadow-2xl">
                        <h2 className="text-2xl font-bold text-amber-700 border-b-4 border-amber-500 pb-2 mb-4 flex items-center">
                            <Loader2 className="w-5 h-5 mr-2 text-amber-500" /> {/* <-- REMOVED animate-spin */}
                            Working On ({workingOnOrders.length})
                        </h2>
                        <div className="space-y-4">
                            {workingOnOrders.length === 0 ? (
                                <p className="text-gray-500 p-4 bg-amber-50 rounded-lg italic">
                                    No new orders to prepare.
                                </p>
                            ) : (
                                workingOnOrders.map(order => (
                                    <KitchenOrderTicket key={order.id} order={order} />
                                ))
                            )}
                        </div>
                    </div>

                    {/* --- DONE Column --- */}
                    <div className="bg-white p-5 rounded-xl shadow-2xl">
                        <h2 className="text-2xl font-bold text-green-700 border-b-4 border-green-500 pb-2 mb-4 flex items-center">
                            <CheckCheck className="w-5 h-5 mr-2 text-green-500" />
                            DONE (Ready for Pickup) ({doneOrders.length})
                        </h2>
                        <div className="space-y-4">
                            {doneOrders.length === 0 ? (
                                <p className="text-gray-500 p-4 bg-green-50 rounded-lg italic">
                                    Completed orders will appear here.
                                </p>
                            ) : (
                                doneOrders.map(order => (
                                    <KitchenOrderTicket key={order.id} order={order} />
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderContent = () => {
        switch (activeSection) {
            case 'home':
                return renderHome();
            case 'menu':
                return renderMenu();
            case 'cart':
                return renderCart();
            case 'checkout':
                return renderCheckout();
            case 'dashboard':
                return renderDashboard();
            default:
                return renderHome();
        }
    };
    
    // Main component return structure
    return (
        <div className="min-h-screen bg-gray-100 font-sans flex flex-col">
            <OrderStatusMessage status={orderStatus} />

            {/* Desktop Sidebar Navigation (Hidden on Mobile) */}
            <div className="hidden md:flex bg-white shadow-xl p-6 border-r border-gray-200 fixed top-0 left-0 h-full flex-col space-y-6 z-10 w-[140px] lg:w-[180px]">
                <div className="text-center py-4">
                    <h1 className="text-3xl font-extrabold text-purple-700 font-serif">Saffron</h1>
                    <h2 className="text-sm text-gray-500">The Table</h2>
                </div>
                
                <div className="flex flex-col space-y-6 flex-grow">
                    <NavButton sectionName="home" label="Home" IconComponent={Home} />
                    <NavButton sectionName="menu" label="Menu" IconComponent={BookOpen} />
                    <NavButton sectionName="cart" label="Cart" IconComponent={ShoppingCart} count={cartItems.length} />
                    {cartItems.length > 0 && (
                        <NavButton sectionName="checkout" label="Checkout" IconComponent={DollarSign} />
                    )}
                </div>

                {/* Owner Dashboard - Styled Differently */}
                <div className="pt-6 border-t border-gray-200">
                    <NavButton sectionName="dashboard" label="Dashboard" IconComponent={ChefHat} count={orders.length} isOwner={true} />
                </div>
            </div>

            {/* Main Content Area */}
            <main className="flex-grow p-4 md:p-8 md:ml-[140px] lg:ml-[180px] mt-16 md:mt-0">
                {isAppReady ? (
                    <div className="container mx-auto max-w-7xl pt-4 pb-20 md:pb-0">
                        {renderContent()}
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full min-h-[50vh] text-purple-600 text-xl font-semibold">
                        <Loader2 className="animate-spin mr-3" size={32} /> Loading Application...
                    </div>
                )}
            </main>

            {/* Mobile Bottom Navigation (Hidden on Desktop) */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-2xl z-20">
                <div className="flex justify-around items-center h-16">
                    <MobileNavButton sectionName="home" label="Home" IconComponent={Home} />
                    <MobileNavButton sectionName="menu" label="Menu" IconComponent={BookOpen} />
                    <MobileNavButton sectionName="cart" label="Cart" IconComponent={ShoppingCart} count={cartItems.length} />
                    <MobileNavButton sectionName="dashboard" label="Owner" IconComponent={ChefHat} />
                </div>
            </div>
        </div>
    );
}

