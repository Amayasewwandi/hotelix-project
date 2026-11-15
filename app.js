/* ==========================================================================
   HOTELIX - MULTI-PAGE APPLICATION CONTROLLER (Backend Connected & Safe)
   Updated with Robust Room ID Matching & Flexible Booking Validation
   ========================================================================== */

// 1. Configuration Constants (Environment / Base URL management)
const CONFIG = {
    API_BASE_URL: window.ENV_API_URL || 'https://hotelixbackend-production.up.railway.app/api'
};

// Helper for API requests with enhanced security checks
async function apiRequest(endpoint, method = 'GET', data = null) {
    const headers = {
        'Content-Type': 'application/json'
    };

    const token = localStorage.getItem('hotelix_token');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
        method,
        headers,
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, options);
        
        if (response.status === 401 && !endpoint.toLowerCase().startsWith('/auth/login')) {
            console.warn("Unauthorized access or token expired. Redirecting to login...");
            localStorage.removeItem('hotelix_user');
            localStorage.removeItem('hotelix_token');
            if (!window.location.pathname.includes('login.html')) {
                window.location.href = 'login.html';
            }
            throw new Error("Session expired. Please log in again.");
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || errorData.title || `HTTP error! status: ${response.status}`);
        }
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

let state = {
    rooms: [],
    staff: [],
    bookings: [],
    currentUser: (() => {
        try {
            const savedUser = JSON.parse(localStorage.getItem('hotelix_user') || 'null');
            const savedUserId = Number(savedUser?.userId ?? savedUser?.user_id);
            if (!savedUser || !Number.isInteger(savedUserId) || savedUserId <= 0) {
                localStorage.removeItem('hotelix_user');
                localStorage.removeItem('hotelix_token');
                return null;
            }
            return savedUser;
        } catch {
            localStorage.removeItem('hotelix_user');
            localStorage.removeItem('hotelix_token');
            return null;
        }
    })(),
    currentOrder: [],
    selectedHkServices: ['Room Cleaning'],
    selectedBookingRoom: null,
    selectedRoomPrice: 0,
    selectedRoomId: null
};

// --- APP ROUTER / PAGE DETECTOR ---
document.addEventListener("DOMContentLoaded", async () => {
    const path = window.location.pathname;
    const page = path.substring(path.lastIndexOf("/") + 1) || "index.html";

    if (page === "index.html" || page === "") {
        window.addEventListener("scroll", () => {
            const header = document.getElementById("main-header");
            if (header) {
                if (window.scrollY > 50) {
                    header.classList.add("scrolled");
                } else {
                    header.classList.remove("scrolled");
                }
            }
        });

        const toggleBtn = document.querySelector(".mobile-menu-toggle");
        const navLinks = document.querySelector(".nav-links");
        if (toggleBtn && navLinks) {
            toggleBtn.addEventListener("click", () => {
                navLinks.classList.toggle("mobile-open");
            });
        }
    }

    try {
        await loadAllBookings();
    } catch (e) {
        console.warn("Backend API is offline. Running in offline UI mode.");
    }

    if (page === "index.html" || page === "") {
        initIndexPage();
    } else if (page === "login.html") {
        initLoginPage();
    } else if (page === "guest.html") {
        if (ensureRoleAccess(['guest'])) initGuestPage();
    } else if (page === "admin.html") {
        if (ensureRoleAccess(['admin'])) initAdminPage();
    } else if (page === "staff.html") {
        if (ensureRoleAccess(['staff', 'admin'])) initStaffPage();
    }
});

function ensureRoleAccess(allowedRoles) {
    const currentRole = String(state.currentUser?.role || '').trim().toLowerCase();
    const allowed = allowedRoles.map(role => role.toLowerCase());
    if (!state.currentUser || !allowed.includes(currentRole)) {
        localStorage.removeItem('hotelix_user');
        localStorage.removeItem('hotelix_token');
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

async function loadAllBookings() {
    try {
        state.bookings = await apiRequest('/Bookings') || [];
    } catch (e) {
        console.error("Could not fetch bookings from backend", e);
        state.bookings = [];
    }
}

// ==========================================================================
// PAGE INITIALIZERS
// ==========================================================================

async function initIndexPage() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const checkinEl = document.getElementById('check-in-date');
    const checkoutEl = document.getElementById('check-out-date');
    const modalCheckin = document.getElementById('booking-checkin');
    const modalCheckout = document.getElementById('booking-checkout');

    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    if (checkinEl) checkinEl.value = todayStr;
    if (checkoutEl) checkoutEl.value = tomorrowStr;
    if (modalCheckin) modalCheckin.value = todayStr;
    if (modalCheckout) modalCheckout.value = tomorrowStr;

    try {
        state.rooms = await apiRequest('/Rooms') || [];
    } catch (e) {
        console.warn("Could not load rooms on index page", e);
    }
}

function initLoginPage() {
    if (state.currentUser && state.currentUser.role) {
        const role = state.currentUser.role.toLowerCase().trim();
        if (role === 'admin') {
            window.location.href = 'admin.html';
        } else if (role === 'staff') {
            window.location.href = 'staff.html';
        } else {
            window.location.href = 'guest.html';
        }
    }
}

function initGuestPage() {
    renderGuestDashboard();
}

function initAdminPage() {
    renderAdminDashboard();
    renderAdminRooms();
    renderAdminStaff();
}

function initStaffPage() {
    renderStaffDashboard();
}

// ==========================================================================
// LOGIN FUNCTION
// ==========================================================================

async function handleLogin(event) {
    event.preventDefault();

    const roleEl = document.getElementById('login-role');
    const emailEl = document.getElementById('login-email');
    const passwordEl = document.getElementById('login-password');
    if (!roleEl || !emailEl || !passwordEl) return;

    const role = roleEl.value.toLowerCase().trim();
    const email = emailEl.value.trim();
    const password = passwordEl.value;
    if (!email || !password) {
        showFeedbackAlert("Please enter your email address and password.", "Close", null, false);
        return;
    }

    try {
        const result = await apiRequest('/Auth/login', 'POST', { email, password, role });
        const loggedUser = {
            userId: result.userId,
            user_id: result.userId,
            name: result.name,
            email: result.email,
            role: String(result.role || role).toLowerCase()
        };
        state.currentUser = loggedUser;
        localStorage.setItem('hotelix_user', JSON.stringify(loggedUser));
        localStorage.removeItem('hotelix_token');

        showFeedbackAlert(`Login Successful! Welcome back, ${loggedUser.name}.`, "Continue", () => {
            if (loggedUser.role === 'admin') window.location.href = 'admin.html';
            else if (loggedUser.role === 'staff') window.location.href = 'staff.html';
            else window.location.href = 'guest.html';
        }, true);
    } catch (error) {
        console.error("Login failed:", error);
        showFeedbackAlert(error.message || "Login failed. Please check your email and password.", "Close", null, false);
    }
}

// ==========================================================================
// INDEX PAGE BOOKING FUNCTIONS
// ==========================================================================

async function initiateBooking(roomId, roomName, price) {
    if (typeof roomId === 'string' && typeof roomName === 'number') {
        price = roomName;
        roomName = roomId;
        roomId = null;
    }

    if (!state.currentUser) {
        showFeedbackAlert("Please login first to book a room.", "Login", () => {
            window.location.href = 'login.html';
        }, false);
        return;
    }

    state.selectedBookingRoom = roomName;
    state.selectedRoomPrice = price;

    if (!state.rooms || state.rooms.length === 0) {
        try {
            state.rooms = await apiRequest('/Rooms') || [];
        } catch (e) {
            console.error("Failed to fetch rooms during booking initiation", e);
        }
    }

    const formattedSearchName = String(roomName || '').toLowerCase().trim();
    const matchedRoom = state.rooms.find(r => {
        const type = (r.roomType || r.room_type || r.type || '').toLowerCase().trim();
        return type === formattedSearchName;
    });

    const requestedRoomId = Number(roomId);
    const roomById = state.rooms.find(r =>
        Number(r.roomId ?? r.room_id ?? r.id) === requestedRoomId
    );

    // Prefer the database room matched by its displayed name. Only use the
    // hard-coded card ID if that ID really exists in the database.
    const actualRoom = matchedRoom || roomById;
    state.selectedRoomId = actualRoom
        ? Number(actualRoom.roomId ?? actualRoom.room_id ?? actualRoom.id)
        : null;

    const hiddenInput = document.getElementById('booking-room-id-value');
    if (hiddenInput) hiddenInput.value = state.selectedRoomId || '';

    const bookingPromptModal = document.getElementById('booking-prompt-modal');
    if (bookingPromptModal) {
        bookingPromptModal.classList.remove('modal-hidden');
        
        const roomTitleEl = document.getElementById('booking-modal-room');
        if (roomTitleEl) {
            roomTitleEl.innerText = roomName;
        }

        const priceCalcEl = document.getElementById('booking-modal-price-calc');
        if (priceCalcEl) {
            priceCalcEl.innerText = `$${price}`;
        }

        const nameInput = document.getElementById('booking-guest-name');
        if (nameInput && state.currentUser) {
            nameInput.value = state.currentUser.name;
        }
    }
}

function closeBookingPromptModal() {
    const bookingPromptModal = document.getElementById('booking-prompt-modal');
    if (bookingPromptModal) {
        bookingPromptModal.classList.add('modal-hidden');
    }
}

function navigateToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
    }
}

function scrollToSection(sectionId) {
    navigateToSection(sectionId);
}

function searchAvailability() {
    navigateToSection('rooms');
}

async function handleContactSubmit(event) {
    event.preventDefault();
    showFeedbackAlert("Your message has been sent successfully! We will get back to you shortly.", "Close", null, true);
    document.getElementById('contact-form').reset();
}

async function processRoomBooking(event) {
    event.preventDefault();

    const guestName = document.getElementById('booking-guest-name').value.trim();
    const checkIn = document.getElementById('booking-checkin').value;
    const checkOut = document.getElementById('booking-checkout').value;
    const roomId = Number(state.selectedRoomId);

    if (!Number.isInteger(roomId) || roomId <= 0) {
        showFeedbackAlert("This room is not connected to a valid database record. Please refresh the page and select the room again.", "Close", null, false);
        return;
    }

    if (!checkIn || !checkOut || checkOut <= checkIn) {
        showFeedbackAlert("Please choose a check-out date after the check-in date.", "Close", null, false);
        return;
    }

    // ASP.NET Core uses camelCase JSON by default. Match the C# Booking model.
    const newBooking = {
        bookingId: 0,
        userId: state.currentUser?.user_id ?? state.currentUser?.userId ?? null,
        roomId: roomId,
        checkIn: checkIn,
        checkOut: checkOut,
        status: 'Confirmed'
    };

    try {
        await apiRequest('/Bookings', 'POST', newBooking);
        closeBookingPromptModal();
        showFeedbackAlert(`Booking Confirmed for ${state.selectedBookingRoom} (${guestName})!`, "View Dashboard", () => {
            window.location.href = 'guest.html';
        }, true);
    } catch (e) {
        console.error("DETAILED BOOKING API ERROR:", e);
        showFeedbackAlert(e.message || "Unable to complete this booking. Please check the selected room and dates, then try again.", "Close", null, false);
    }
}

// ==========================================================================
function switchAdminTab(tabName) {
    const panels = document.querySelectorAll('.dashboard-panel');
    panels.forEach(panel => panel.classList.add('panel-hidden'));

    const tabButtons = document.querySelectorAll('.dashboard-nav-tabs .tab-btn');
    tabButtons.forEach(btn => btn.classList.remove('active-tab-btn'));

    const targetPanel = document.getElementById(`panel-admin-${tabName}`);
    if (targetPanel) targetPanel.classList.remove('panel-hidden');

    const targetButton = document.getElementById(`tab-admin-${tabName}`);
    if (targetButton) targetButton.classList.add('active-tab-btn');
}

function switchGuestTab(tabName) {
    const panels = document.querySelectorAll('.dashboard-panel');
    panels.forEach(panel => panel.classList.add('panel-hidden'));

    const tabButtons = document.querySelectorAll('.dashboard-nav-tabs .tab-btn');
    tabButtons.forEach(btn => btn.classList.remove('active-tab-btn'));

    const targetPanel = document.getElementById(`panel-guest-${tabName}`);
    if (targetPanel) {
        targetPanel.classList.remove('panel-hidden');
    }

    const targetButton = document.getElementById(`tab-guest-${tabName}`);
    if (targetButton) {
        targetButton.classList.add('active-tab-btn');
    }
}

async function renderStaffDashboard() {
    const staffNameEl = document.getElementById('staff-name');
    if (staffNameEl && state.currentUser) {
        staffNameEl.innerText = state.currentUser.name;
    }

    try {
        const bookings = await apiRequest('/Bookings') || [];
        const bookingsTbody = document.getElementById('staff-bookings-tbody');
        if (bookingsTbody) {
            if (bookings.length > 0) {
                bookingsTbody.innerHTML = bookings.map(bk => `
                    <tr>
                        <td>#${bk.bookingId || bk.booking_id || ''}</td>
                        <td>Guest #${(bk.userId ?? bk.user_id)}</td>
                        <td>Room #${(bk.roomId ?? bk.room_id)}</td>
                        <td>${formatDateStr((bk.checkIn || bk.check_in))}</td>
                        <td>${formatDateStr((bk.checkOut || bk.check_out))}</td>
                        <td><span class="badge success">${bk.status || 'Confirmed'}</span></td>
                    </tr>
                `).join('');
            } else {
                bookingsTbody.innerHTML = `<tr><td colspan="6" style="text-align: center;">No active bookings found.</td></tr>`;
            }
        }

        const services = await apiRequest('/Services') || [];
        const servicesTbody = document.getElementById('staff-services-tbody');
        if (servicesTbody) {
            if (services.length > 0) {
                servicesTbody.innerHTML = services.map(st => `
                    <tr>
                        <td>#${st.orderId ?? st.order_id ?? st.id ?? ''}</td>
                        <td>User #${st.userId ?? st.user_id ?? 'N/A'}</td>
                        <td>${st.serviceType ?? st.service_type ?? 'General'}</td>
                        <td>${st.details || 'N/A'}</td>
                        <td><span class="badge pending">${st.status || 'Pending'}</span></td>
                    </tr>
                `).join('');
            } else {
                servicesTbody.innerHTML = `<tr><td colspan="5" style="text-align: center;">No service requests found.</td></tr>`;
            }
        }
    } catch (e) {
        console.error("Error loading staff dashboard data:", e);
    }
}

async function renderAdminDashboard() {
    try {
        const [bookings, rooms] = await Promise.all([
            apiRequest('/Bookings'),
            apiRequest('/Rooms')
        ]);
        state.bookings = bookings || [];
        state.rooms = rooms || [];
    } catch (e) {
        console.error("Could not load admin room statistics:", e);
        showFeedbackAlert("Could not load room statistics from the database. Please check the backend connection.", "Close", null, false);
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeStatuses = ['confirmed', 'pending', 'booked'];

    const currentlyBookedRoomIds = new Set(
        state.bookings.filter(bk => {
            const status = String(bk.status || '').toLowerCase();
            const checkIn = new Date(bk.checkIn || bk.check_in);
            const checkOut = new Date(bk.checkOut || bk.check_out);
            checkIn.setHours(0, 0, 0, 0);
            checkOut.setHours(0, 0, 0, 0);
            return activeStatuses.includes(status) && checkIn <= today && checkOut > today;
        }).map(bk => Number(bk.roomId ?? bk.room_id)).filter(id => Number.isInteger(id) && id > 0)
    );

    const totalRooms = state.rooms.length;
    const bookedRooms = currentlyBookedRoomIds.size;
    const availableRooms = Math.max(0, totalRooms - bookedRooms);

    const totalRoomsEl = document.getElementById('stat-total-rooms');
    const bookedRoomsEl = document.getElementById('stat-booked-rooms');
    const availableRoomsEl = document.getElementById('stat-available-rooms');
    const totalBookingsEl = document.getElementById('stat-total-bookings');

    if (totalRoomsEl) totalRoomsEl.textContent = totalRooms;
    if (bookedRoomsEl) bookedRoomsEl.textContent = bookedRooms;
    if (availableRoomsEl) availableRoomsEl.textContent = availableRooms;
    if (totalBookingsEl) totalBookingsEl.textContent = state.bookings.length;

    const recentTbody = document.getElementById('admin-recent-bookings-tbody');
    if (recentTbody) {
        recentTbody.innerHTML = state.bookings.length > 0
            ? state.bookings.slice(0, 5).map(bk => `
                <tr>
                    <td>Guest #${bk.userId ?? bk.user_id ?? 'N/A'}</td>
                    <td>Room #${bk.roomId ?? bk.room_id ?? 'N/A'}</td>
                    <td>${formatDateStr(bk.checkIn || bk.check_in)}</td>
                    <td><span class="status-badge confirmed">${bk.status || 'Confirmed'}</span></td>
                </tr>
            `).join('')
            : '<tr><td colspan="4" style="text-align:center;">No bookings found.</td></tr>';
    }

    renderAdminBookings();
}

async function renderAdminBookings() {
    await loadAllBookings();
    const tbody = document.getElementById('admin-bookings-tbody');
    if (!tbody) return;

    if (state.bookings.length > 0) {
        tbody.innerHTML = state.bookings.map(bk => {
            const bookingId = bk.bookingId ?? bk.booking_id;
            const userId = bk.userId ?? bk.user_id ?? 'N/A';
            const roomId = bk.roomId ?? bk.room_id ?? 'N/A';
            return `
                <tr>
                    <td>#${bookingId ?? ''}</td>
                    <td>Guest #${userId}</td>
                    <td>Room #${roomId}</td>
                    <td>${formatDateStr(bk.checkIn || bk.check_in)}</td>
                    <td>${formatDateStr(bk.checkOut || bk.check_out)}</td>
                    <td><span class="status-badge confirmed">${bk.status || 'Confirmed'}</span></td>
                    <td>
                        <button class="btn-table-action delete" onclick="deleteBooking(${Number(bookingId)})"><i class="fa-solid fa-ban"></i> Delete</button>
                    </td>
                </tr>
            `;
        }).join('');
    } else {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center;">No bookings found.</td></tr>`;
    }
}

async function renderAdminRooms() {
    const tbody = document.getElementById('admin-rooms-tbody');
    if (!tbody) return;

    try {
        const roomsData = await apiRequest('/Rooms') || [];
        state.rooms = roomsData;

        if (roomsData.length > 0) {
            tbody.innerHTML = roomsData.map((room, index) => `
                <tr>
                    <td>#${room.roomId || room.room_id || room.id}</td>
                    <td>${room.roomType || room.room_type || room.type || 'Deluxe'}</td>
                    <td>$${room.price ?? 150}</td>
                    <td><span class="status-badge ${(room.status || 'Available').toLowerCase()}">${room.status || 'Available'}</span></td>
                    <td>
                        <button class="btn-table-action delete" onclick="deleteRoom(${room.roomId || room.room_id || room.id || index})"><i class="fa-solid fa-trash"></i> Delete</button>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center;">No rooms found in database.</td></tr>`;
        }
    } catch (e) {
        console.error("Error loading rooms:", e);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: red;">Failed to load rooms from database.</td></tr>`;
    }
}

async function renderAdminStaff() {
    const tbody = document.getElementById('admin-staff-tbody');
    const theadTr = document.querySelector('#panel-admin-staff .dashboard-table thead tr');
    if (!tbody) return;

    if (theadTr) {
        theadTr.innerHTML = `
            <th>Order ID</th>
            <th>Guest ID</th>
            <th>Service Type</th>
            <th>Details / Info</th>
            <th>Status</th>
            <th>Actions</th>
        `;
    }

    try {
        const servicesData = await apiRequest('/Services') || [];
        
        if (servicesData.length > 0) {
            tbody.innerHTML = servicesData.map((st) => `
                <tr>
                    <td>#${st.orderId ?? st.order_id ?? st.id ?? ''}</td>
                    <td>User #${st.userId ?? st.user_id ?? 'N/A'}</td>
                    <td><strong>${st.serviceType ?? st.service_type ?? 'General Service'}</strong></td>
                    <td>${st.details || 'N/A'}</td>
                    <td><span class="status-badge active">${st.status || 'Pending'}</span></td>
                    <td>
                        <button class="btn-table-action delete" onclick="deleteStaff(${Number(st.orderId ?? st.order_id ?? st.id)})"><i class="fa-solid fa-trash"></i> Delete</button>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center;">No service requests found in database.</td></tr>`;
        }
    } catch (e) {
        console.error("Error loading services from database:", e);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: red;">Failed to load services from database.</td></tr>`;
    }
}

async function handleRoomSave(event) {
    event.preventDefault();

    const roomNo = document.getElementById('room-form-no').value;
    const roomType = document.getElementById('room-form-type').value;
    const price = document.getElementById('room-form-price').value;
    const status = document.getElementById('room-form-status').value;

    const roomId = Number.parseInt(roomNo, 10);
    if (!Number.isInteger(roomId) || roomId <= 0) {
        showFeedbackAlert("Please enter a valid, unused numeric room ID.", "Close", null, false);
        return;
    }
    const newRoom = { roomId, roomType, price: parseFloat(price) || 0, status };

    try {
        await apiRequest('/Rooms', 'POST', newRoom);
        closeRoomModal();
        renderAdminRooms();
        showFeedbackAlert("Room added successfully!", "Close", null, true);
        document.getElementById('admin-room-form').reset();
    } catch (e) {
        console.error("Error saving room:", e);
        showFeedbackAlert("Failed to save room to database.", "Close", null, false);
    }
}

async function handleStaffSave(event) {
    event.preventDefault();

    const guestId = document.getElementById('staff-form-name').value.trim();
    const serviceType = document.getElementById('staff-form-desig').value;
    const details = document.getElementById('staff-form-dept').value;
    const status = document.getElementById('staff-form-status').value;

    const parsedGuestId = guestId ? Number.parseInt(guestId, 10) : null;
    const newServiceRequest = {
        userId: Number.isInteger(parsedGuestId) && parsedGuestId > 0 ? parsedGuestId : null,
        serviceType,
        details,
        status
    };

    try {
        await apiRequest('/Services', 'POST', newServiceRequest);
        closeStaffModal();
        renderAdminStaff();
        showFeedbackAlert("Service request saved successfully!", "Close", null, true);
        document.getElementById('admin-staff-form').reset();
    } catch (e) {
        console.error("Error saving service request:", e);
        closeStaffModal();
        showFeedbackAlert("Failed to save service request to database.", "Close", null, false);
    }
}

function openAddRoomModal() {
    const roomModal = document.getElementById('admin-room-modal');
    if (roomModal) roomModal.classList.remove('modal-hidden');
}

function closeRoomModal() {
    const roomModal = document.getElementById('admin-room-modal');
    if (roomModal) roomModal.classList.add('modal-hidden');
}

function openAddStaffModal() {
    const staffModal = document.getElementById('admin-staff-modal');
    if (staffModal) staffModal.classList.remove('modal-hidden');
}

function closeStaffModal() {
    const staffModal = document.getElementById('admin-staff-modal');
    if (staffModal) staffModal.classList.add('modal-hidden');
}

async function deleteBooking(id) {
    if (confirm("Are you sure you want to delete this booking?")) {
        try {
            await apiRequest(`/Bookings/${id}`, 'DELETE');
            state.bookings = state.bookings.filter(b => Number(b.bookingId ?? b.booking_id) !== Number(id));
            renderAdminBookings();
            showFeedbackAlert("Booking deleted successfully!", "Close", null, true);
        } catch (e) {
            console.error("Error deleting booking:", e);
            showFeedbackAlert("Failed to delete booking from database.", "Close", null, false);
        }
    }
}

async function deleteStaff(id) {
    if (confirm("Are you sure you want to delete this service request?")) {
        try {
            await apiRequest(`/Services/${id}`, 'DELETE');
            renderAdminStaff();
            showFeedbackAlert("Service request deleted successfully!", "Close", null, true);
        } catch (e) {
            console.error("Error deleting service request:", e);
            showFeedbackAlert("Failed to delete service request from database.", "Close", null, false);
        }
    }
}

async function deleteRoom(id) {
    if (confirm("Are you sure you want to delete this room?")) {
        try {
            await apiRequest(`/Rooms/${id}`, 'DELETE');
            renderAdminRooms();
            showFeedbackAlert("Room deleted successfully!", "Close", null, true);
        } catch (e) {
            console.error("Error deleting room from DB:", e);
            showFeedbackAlert("Failed to delete room from database.", "Close", null, false);
        }
    }
}

async function renderGuestDashboard() {
    const welcomeTitle = document.getElementById('guest-welcome-title');
    if (welcomeTitle && state.currentUser) {
        welcomeTitle.innerText = `Welcome back, ${state.currentUser.name}!`;
    }

    const activeCard = document.getElementById('guest-active-booking-card');
    if (!activeCard) return;
    try {
        const bookings = await apiRequest('/Bookings') || [];
        const userId = state.currentUser?.userId ?? state.currentUser?.user_id;
        const ownBookings = userId == null ? [] : bookings.filter(b =>
            Number(b.userId ?? b.user_id) === Number(userId));
        const latest = ownBookings[ownBookings.length - 1];
        if (!latest) {
            activeCard.style.display = 'none';
            return;
        }
        const roomId = latest.roomId ?? latest.room_id;
        const checkIn = latest.checkIn ?? latest.check_in;
        const checkOut = latest.checkOut ?? latest.check_out;
        activeCard.style.display = 'block';
        const roomName = document.getElementById('active-room-name');
        const inDate = document.getElementById('active-check-in');
        const outDate = document.getElementById('active-check-out');
        const roomNumber = document.getElementById('active-room-number');
        if (roomName) roomName.innerText = `Room #${roomId}`;
        if (inDate) inDate.innerText = formatDateStr(checkIn);
        if (outDate) outDate.innerText = formatDateStr(checkOut);
        if (roomNumber) roomNumber.innerText = roomId ?? '';
    } catch (error) {
        console.error('Could not load guest bookings:', error);
        activeCard.style.display = 'none';
    }
}

function logout() {
    state.currentUser = null;
    localStorage.clear(); 
    window.location.href = 'login.html';
}

let onFeedbackCloseCallback = null;
function showFeedbackAlert(message, actionText = "Close", onClose = null, isSuccess = true) {
    const alertMsg = document.getElementById('feedback-alert-message');
    const alertBtn = document.getElementById('feedback-alert-action-btn');
    const feedbackAlertModal = document.getElementById('feedback-alert-modal');
    const iconContainer = document.querySelector('.feedback-icon-circle');

    if (alertMsg) alertMsg.innerText = message;
    if (alertBtn) alertBtn.innerText = actionText;
    onFeedbackCloseCallback = onClose;

    if (iconContainer) {
        if (isSuccess) {
            iconContainer.innerHTML = '<i class="fa-solid fa-check" style="color: #2e7d32;"></i>';
            iconContainer.style.backgroundColor = '#e8f5e9';
        } else {
            iconContainer.innerHTML = '<i class="fa-solid fa-xmark" style="color: #c62828;"></i>';
            iconContainer.style.backgroundColor = '#ffebee';
        }
    }

    if (feedbackAlertModal) feedbackAlertModal.classList.remove('modal-hidden');
}

function closeFeedbackAlert() {
    const feedbackAlertModal = document.getElementById('feedback-alert-modal');
    if (feedbackAlertModal) feedbackAlertModal.classList.add('modal-hidden');
    if (onFeedbackCloseCallback) {
        onFeedbackCloseCallback();
        onFeedbackCloseCallback = null;
    }
}

function formatDateStr(dateString) {
    if (!dateString) return '';
    const dateOnly = String(dateString).slice(0, 10);
    const parts = dateOnly.split('-').map(Number);
    const date = parts.length === 3 && parts.every(Number.isFinite)
        ? new Date(parts[0], parts[1] - 1, parts[2])
        : new Date(dateString);
    return Number.isNaN(date.getTime()) ? '' :
        date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ==========================================================================
// GUEST SERVICES & ROOM SERVICE ORDERING LOGIC
// ==========================================================================

function addRoomServiceItem(itemName, price) {
    const existingItem = state.currentOrder.find(item => item.name === itemName);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        state.currentOrder.push({ name: itemName, price: price, quantity: 1 });
    }
    renderOrderSummary();
}

function removeRoomServiceItem(itemName) {
    state.currentOrder = state.currentOrder.filter(item => item.name !== itemName);
    renderOrderSummary();
}

function renderOrderSummary() {
    const summaryList = document.getElementById('room-service-summary-list');
    const totalAmountEl = document.getElementById('room-service-total-amount');

    if (!summaryList) return;

    if (state.currentOrder.length === 0) {
        summaryList.innerHTML = '<p class="empty-order-msg">No items added yet. Click "Add to Order" to start.</p>';
        if (totalAmountEl) totalAmountEl.innerText = '$0';
        return;
    }

    let html = '<ul style="list-style: none; padding: 0; width: 100%;">';
    let total = 0;

    state.currentOrder.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        html += `
            <li style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 5px;">
                <span>${item.name} (x${item.quantity})</span>
                <span>$${itemTotal} <button type="button" onclick="removeRoomServiceItem('${item.name}')" style="background:none; border:none; color:red; cursor:pointer; margin-left:10px;"><i class="fa-solid fa-trash"></i></button></span>
            </li>
        `;
    });
    html += '</ul>';

    summaryList.innerHTML = html;
    if (totalAmountEl) {
        totalAmountEl.innerText = `$${total}`;
    }
}

async function confirmRoomServiceOrder(event) {
    if (event) event.preventDefault();

    if (state.currentOrder.length === 0) {
        showFeedbackAlert("Please add at least one item to your order first.", "Close", null, false);
        return;
    }

    const userIdToUse = state.currentUser?.userId ?? state.currentUser?.user_id ?? null;

    const orderData = {
        orderId: 0,
        userId: userIdToUse,
        serviceType: 'Room Service',
        details: JSON.stringify(state.currentOrder),
        status: 'Pending'
    };

    try {
        await apiRequest('/Services', 'POST', orderData);
        showFeedbackAlert("Room Service Order placed successfully! Our staff will attend to it shortly.", "Close", () => {
            state.currentOrder = [];
            renderOrderSummary();
        }, true);
    } catch (e) {
        console.error("Error submitting room service:", e);
        showFeedbackAlert("Failed to submit order to database.", "Close", null, false);
    }
}

// ==========================================================================
// GUEST SERVICES SUB-SECTION & HOUSEKEEPING LOGIC
// ==========================================================================

function toggleServiceSubSection(sectionNameCode, clickedButton) {
    const roomServiceEl = document.getElementById('guest-sub-room-service');
    const housekeepingEl = document.getElementById('guest-sub-housekeeping');
    const toggles = document.querySelectorAll('.service-panel-toggle');

    toggles.forEach(btn => btn.classList.remove('active-service-toggle'));

    if (sectionNameCode === 'room-service') {
        if (roomServiceEl) roomServiceEl.classList.remove('panel-hidden');
        if (housekeepingEl) housekeepingEl.classList.add('panel-hidden');
        if (clickedButton) clickedButton.classList.add('active-service-toggle');
    } else if (sectionNameCode === 'housekeeping') {
        if (roomServiceEl) roomServiceEl.classList.add('panel-hidden');
        if (housekeepingEl) housekeepingEl.classList.remove('panel-hidden');
        if (clickedButton) clickedButton.classList.add('active-service-toggle');
    }
}

function togglePill(button, value) {
    button.classList.toggle('selected');
}

function selectSinglePill(button, containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        const pills = container.querySelectorAll('.pill-btn');
        pills.forEach(p => p.classList.remove('selected')); 
    }
    button.classList.add('selected');
}

async function submitHousekeepingRequest(event) {
    if (event) event.preventDefault();

    const selectedPills = document.querySelectorAll('#hk-service-type-pills .pill-btn.selected');
    let serviceTypes = [];
    selectedPills.forEach(p => {
        if (p.innerText && !serviceTypes.includes(p.innerText)) {
            serviceTypes.push(p.innerText.trim());
        }
    });

    const selectedTimeSlot = document.querySelector('#hk-time-slot-pills .pill-btn.selected, #guest-sub-housekeeping #hk-time-slot-pills .pill-btn.selected');
    const timeSlot = selectedTimeSlot ? selectedTimeSlot.innerText.trim() : 'Morning [9 AM - 12 PM]';
    
    const notesEl = document.getElementById('hk-special-notes');
    const notes = notesEl ? notesEl.value.trim() : '';

    const finalServiceType = serviceTypes.length > 0 ? serviceTypes.join(', ') : 'Room Cleaning';
    const finalDetails = `Time Slot: ${timeSlot} | Notes: ${notes}`;

    const userIdToUse = state.currentUser?.userId ?? state.currentUser?.user_id ?? null;

    const housekeepingData = {
        orderId: 0,
        userId: userIdToUse,
        serviceType: finalServiceType,
        details: finalDetails,
        status: 'Pending'
    };

    try {
        await apiRequest('/Services', 'POST', housekeepingData);
        showFeedbackAlert("Housekeeping request submitted successfully! Our staff will attend to your room.", "Close", () => {
            const hkForm = document.getElementById('housekeeping-request-form');
            if (hkForm) hkForm.reset();
        }, true);
    } catch (e) {
        console.error("Error submitting housekeeping:", e);
        showFeedbackAlert("Failed to submit housekeeping request to database.", "Close", null, false);
    }
}
