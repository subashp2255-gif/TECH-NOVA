import React, { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { bookingService } from '../../services/bookingService';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { QrCode, Clock, MapPin, Calendar, AlertTriangle, CheckCircle2, XCircle, LogOut, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format, parse, isAfter, isBefore } from 'date-fns';

function getBookingState(booking) {
    if (!booking) return null;
    const rawStatus = (booking.status || '').toUpperCase();
    if (rawStatus === 'CANCELLED_BY_ADMIN') return 'CANCELLED_BY_ADMIN';
    if (rawStatus === 'CANCELLED_BY_STUDENT' || rawStatus === 'CANCELLED') return 'CANCELLED_BY_STUDENT';
    if (rawStatus === 'COMPLETED' || rawStatus === 'CHECKED_OUT') return 'COMPLETED';
    if (rawStatus === 'CHECKOUT_PENDING') return 'CHECKOUT_PENDING';

    const now = new Date();
    const datePart = booking.bookingDate || format(now, 'yyyy-MM-dd');
    let startDateTime = null;
    let endDateTime = null;

    if (booking.slotTime && booking.slotTime.includes('–')) {
        const [rawStart, rawEnd] = booking.slotTime.split('–').map(s => s.trim());
        try {
            startDateTime = parse(`${datePart} ${rawStart}`, 'yyyy-MM-dd hh:mm a', new Date());
            endDateTime = parse(`${datePart} ${rawEnd}`, 'yyyy-MM-dd hh:mm a', new Date());
        } catch {
            startDateTime = null;
        }
    }

    if (!startDateTime) {
        return rawStatus === 'ACTIVE' ? 'ACTIVE' : 'UPCOMING';
    }

    if (isAfter(now, endDateTime)) return 'COMPLETED';
    if (isAfter(now, startDateTime) && isBefore(now, endDateTime)) return 'ACTIVE';
    return 'UPCOMING';
}

export default function MyReservations() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedQrBookingId, setExpandedQrBookingId] = useState(null);
    const [cancelTarget, setCancelTarget] = useState(null);
    const [cancelling, setCancelling] = useState(false);

    const [checkoutToken, setCheckoutToken] = useState(null);
    const [showCheckoutQrModal, setShowCheckoutQrModal] = useState(false);

    const fetchBookings = async () => {
        if (!user) return;
        try {
            setLoading(true);
            const userBookings = await bookingService.getMyBookings(user.id);
            setBookings(userBookings);
        } catch (error) {
            toast.error('Failed to load bookings');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBookings();
    }, [user]);

    useSync((event) => {
        if (event?.type === 'storage_change') {
            fetchBookings();
        }
    });

    const toggleQrPass = (bookingId) => {
        setExpandedQrBookingId(currentId => String(currentId) === String(bookingId) ? null : bookingId);
    };

    const handleRequestCheckout = async (booking) => {
        if (!booking || !user) return;
        try {
            const payload = {
                token: `CKOUT-${booking.id}-${Math.floor(1000 + Math.random() * 9000)}`,
                bookingId: booking.id,
                studentId: user.id,
                studentName: user.name,
                collegeId: user.collegeId,
                seatNumber: booking.seatNumber,
                floorName: booking.floorName || 'Ground Floor',
                slotTime: booking.slotTime,
                issuedAt: new Date().toISOString()
            };

            localStorage.setItem('seatsync_checkout_token', JSON.stringify(payload));

            const allBookings = await db.read('seatsync_bookings');
            const target = allBookings.find(b => b.id === booking.id && b.studentId === user.id);
            if (target) {
                target.status = 'checkout_pending';
                target.checkoutRequestedAt = payload.issuedAt;
                await db.write('seatsync_bookings', allBookings);
            }

            const logs = await db.read('seatsync_activity_logs').catch(() => []);
            logs.push({
                userId: user.id,
                action: 'request_checkout',
                entityId: booking.id,
                timestamp: payload.issuedAt,
            });
            await db.write('seatsync_activity_logs', logs);

            setCheckoutToken(payload);
            setShowCheckoutQrModal(true);
            toast.success('Checkout QR generated — show to librarian.');
            fetchBookings();
        } catch (err) {
            toast.error('Failed to generate Checkout QR.');
        }
    };

    const handleCancelBooking = async () => {
        if (!cancelTarget) return;
        setCancelling(true);
        try {
            await bookingService.cancelBooking(cancelTarget.id, user.id);
            toast.success('Booking cancelled');
            setCancelTarget(null);
            fetchBookings();
        } catch (err) {
            toast.error(err.message || 'Failed to cancel booking');
        } finally {
            setCancelling(false);
        }
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
            <div className="space-y-2 pb-2 border-b border-slate-200/80">
                <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">My Reservations</h1>
                <p className="text-xs sm:text-sm text-slate-500 font-medium">
                    View active, upcoming, and past library seat passes.
                </p>
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[1, 2, 3].map(i => <div key={i} className="h-40 bg-white rounded-2xl border border-slate-200 animate-pulse"></div>)}
                </div>
            ) : bookings.length === 0 ? (
                <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white p-8 text-center space-y-4">
                    <div className="w-14 h-14 rounded-2xl bg-blue-50 text-brandBlue flex items-center justify-center mx-auto">
                        <Clock size={28} />
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-lg font-bold text-navy">No Bookings Found</h3>
                        <p className="text-xs text-slate-500 font-medium">You haven't reserved any library seats yet.</p>
                    </div>
                </Card>
            ) : (
                <div className="space-y-4">
                    {bookings.map(booking => {
                        const computedState = getBookingState(booking);
                        const isExpanded = expandedQrBookingId === booking.id;
                        const isCancelledByAdmin = computedState === 'CANCELLED_BY_ADMIN';

                        return (
                            <Card key={booking.id} className={`border-2 transition-all rounded-2xl overflow-hidden shadow-xs ${
                                isCancelledByAdmin ? 'border-red-200 bg-red-50/10' : 'border-slate-200 hover:border-brandBlue/40 bg-white'
                            }`}>
                                <CardContent className="p-5 space-y-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                                        <div className="flex items-center gap-2">
                                            <Badge className={`font-bold text-xs ${
                                                isCancelledByAdmin ? 'bg-red-600 text-white' :
                                                computedState === 'ACTIVE' ? 'bg-emerald-500 text-white' :
                                                computedState === 'CHECKOUT_PENDING' ? 'bg-amber-500 text-white' :
                                                computedState === 'COMPLETED' ? 'bg-slate-500 text-white' :
                                                computedState === 'CANCELLED_BY_STUDENT' ? 'bg-red-400 text-white' : 'bg-brandBlue text-white'
                                            }`}>
                                                {isCancelledByAdmin ? 'Cancelled by Library' :
                                                 computedState === 'ACTIVE' ? 'Active Session' :
                                                 computedState === 'CHECKOUT_PENDING' ? 'Pending Checkout' :
                                                 computedState === 'COMPLETED' ? 'Completed' :
                                                 computedState === 'CANCELLED_BY_STUDENT' ? 'Cancelled by You' : 'Upcoming'}
                                            </Badge>
                                            <span className="text-xs font-mono font-bold text-slate-500">ID: {booking.id}</span>
                                        </div>

                                        <span className="text-xs font-bold text-slate-600 font-mono flex items-center gap-1">
                                            <Calendar size={14} /> {booking.bookingDate}
                                        </span>
                                    </div>

                                    <div className="grid sm:grid-cols-3 gap-3 bg-slate-50/80 border border-slate-200/80 rounded-xl p-3.5 text-xs">
                                        <div>
                                            <span className="text-slate-400 font-semibold block text-[10px] uppercase">Seat</span>
                                            <span className="font-extrabold text-navy text-sm flex items-center gap-1">
                                                <MapPin size={14} className="text-brandBlue" /> {booking.seatNumber}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-slate-400 font-semibold block text-[10px] uppercase">Time</span>
                                            <span className="font-bold text-navy font-mono">{booking.slotTime}</span>
                                        </div>
                                        <div>
                                            <span className="text-slate-400 font-semibold block text-[10px] uppercase">Floor</span>
                                            <span className="font-bold text-navy">{booking.floorName || 'Ground Floor'}</span>
                                        </div>
                                    </div>

                                    {/* Cancelled By Library Notice */}
                                    {isCancelledByAdmin && (
                                        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs space-y-1.5 animate-in fade-in">
                                            <div className="flex items-center gap-2 font-bold text-red-900">
                                                <AlertTriangle size={16} className="text-red-600 shrink-0" />
                                                <span>Reservation Cancelled by Library Administration</span>
                                            </div>
                                            {booking.cancellationReason && (
                                                <p className="text-slate-700 text-xs font-medium">
                                                    Reason: <strong>{booking.cancellationReason}</strong>
                                                </p>
                                            )}
                                            <div className="pt-1 border-t border-red-200/60 flex items-center gap-1.5 text-[11px] text-emerald-800 font-semibold">
                                                <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                                                <span>The library cancelled this reservation. This will not affect your no-show count or booking eligibility.</span>
                                            </div>
                                        </div>
                                    )}

                                    {isExpanded && !isCancelledByAdmin && (
                                        <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl text-center space-y-3 animate-in fade-in">
                                            <div className="bg-white p-3 rounded-xl border border-slate-200 inline-block">
                                                <QrCode size={120} className="text-navy mx-auto" />
                                            </div>
                                            <p className="text-xs font-bold font-mono text-navy">PASS: {booking.id}-ENTRY</p>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                                        {isCancelledByAdmin ? (
                                            <Button
                                                type="button"
                                                onClick={() => navigate('/student/find-seat')}
                                                className="h-9 text-xs font-bold bg-brandBlue hover:bg-blue-600 text-white rounded-xl"
                                            >
                                                Find Another Slot <ArrowRight size={14} className="ml-1.5" />
                                            </Button>
                                        ) : (
                                            <>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() => toggleQrPass(booking.id)}
                                                    className="h-9 text-xs font-bold rounded-xl"
                                                >
                                                    <QrCode size={14} className="mr-1.5" />
                                                    {isExpanded ? 'Hide QR Pass' : 'View QR Pass'}
                                                </Button>

                                                {computedState === 'ACTIVE' && (
                                                    <Button
                                                        type="button"
                                                        onClick={() => handleRequestCheckout(booking)}
                                                        className="h-9 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
                                                    >
                                                        <LogOut size={14} className="mr-1.5" /> Request Checkout QR
                                                    </Button>
                                                )}

                                                {computedState === 'UPCOMING' && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        onClick={() => setCancelTarget(booking)}
                                                        className="h-9 text-xs font-bold border-red-200 text-red-600 hover:bg-red-50 rounded-xl"
                                                    >
                                                        Cancel Reservation
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            <Dialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
                <DialogContent className="sm:max-w-md rounded-2xl p-6">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-bold text-navy">Cancel Reservation?</DialogTitle>
                        <DialogDescription className="text-xs text-slate-500 pt-1">
                            Are you sure you want to cancel booking {cancelTarget?.id}?
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling} className="rounded-xl text-xs">
                            Keep Booking
                        </Button>
                        <Button onClick={handleCancelBooking} disabled={cancelling} className="bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs">
                            {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
