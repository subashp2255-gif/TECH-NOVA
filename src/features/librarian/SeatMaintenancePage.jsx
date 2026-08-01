import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { librarianService } from '../../services/librarianService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  Wrench, AlertTriangle, Plus, CheckCircle2, Clock, MapPin,
  ShieldCheck, RefreshCw, User, FileText
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function SeatMaintenancePage() {
  const { user: staffUser } = useAuth();
  const [maintenanceList, setMaintenanceList] = useState([]);
  const [seats, setSeats] = useState([]);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Form State
  const [seatNumber, setSeatNumber] = useState('');
  const [category, setCategory] = useState('Broken Frame / Cushion');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [expectedResolution, setExpectedResolution] = useState('Within 24 Hours');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [mntData, seatsData] = await Promise.all([
        db.read('seatsync_maintenance') || [],
        db.read('seatsync_seats') || []
      ]);
      setMaintenanceList(mntData.reverse());
      setSeats(seatsData);
    } catch (err) {
      console.warn('Failed to load maintenance data:', err);
    }
  };

  const handleReportMaintenance = async (e) => {
    e.preventDefault();
    if (!seatNumber) {
      toast.error('Please select a seat number.');
      return;
    }
    if (!description.trim()) {
      toast.error('Please provide a brief issue description.');
      return;
    }

    setLoading(true);
    try {
      await librarianService.reportSeatMaintenance({
        seatNumber,
        category,
        description,
        priority,
        expectedResolution,
        staffUser
      });

      toast.success(`Seat ${seatNumber} marked under maintenance.`);
      setIsReportModalOpen(false);
      setSeatNumber('');
      setDescription('');
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to report maintenance ticket.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (ticketId, status) => {
    try {
      await librarianService.updateMaintenanceStatus(ticketId, status, 'Resolved by staff', staffUser);
      toast.success(`Ticket ${ticketId} updated to ${status}.`);
      await loadData();
    } catch (err) {
      toast.error('Failed to update ticket status.');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Wrench className="text-teal-600" size={28} /> Seat Maintenance & Inspection Desk
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Report damaged library furniture, track repair status, and prevent bookings for seats under repair.
          </p>
        </div>

        <Button
          onClick={() => setIsReportModalOpen(true)}
          className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2"
        >
          <Plus size={16} /> Report Damaged Seat
        </Button>
      </div>

      {/* TICKETS LIST TABLE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <FileText size={18} className="text-teal-600" /> Maintenance Tickets Log
        </h2>

        {maintenanceList.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">No maintenance issues reported.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3">Ticket ID</th>
                  <th className="py-3 px-3">Seat</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Description</th>
                  <th className="py-3 px-3">Priority</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {maintenanceList.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50 text-slate-700">
                    <td className="py-3 px-3 font-bold text-navy">{t.id}</td>
                    <td className="py-3 px-3 text-teal-600 font-bold">{t.seatNumber}</td>
                    <td className="py-3 px-3 text-slate-800 font-sans font-medium">{t.category}</td>
                    <td className="py-3 px-3 text-slate-500 font-sans max-w-xs truncate">{t.description}</td>
                    <td className="py-3 px-3">
                      <Badge className={`text-[10px] font-bold ${
                        t.priority === 'High' ? 'bg-red-600 text-white' :
                        t.priority === 'Medium' ? 'bg-amber-600 text-white' :
                        'bg-slate-500 text-white'
                      }`}>
                        {t.priority}
                      </Badge>
                    </td>
                    <td className="py-3 px-3">
                      <Badge className={`text-[10px] font-bold ${
                        t.status === 'Resolved' ? 'bg-emerald-600 text-white' :
                        t.status === 'In progress' ? 'bg-brandBlue text-white' :
                        'bg-amber-600 text-white'
                      }`}>
                        {t.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-3">
                      {t.status !== 'Resolved' && (
                        <Button
                          onClick={() => handleUpdateStatus(t.id, 'Resolved')}
                          className="h-7 px-2.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg"
                        >
                          Mark Resolved
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* REPORT MODAL */}
      {isReportModalOpen && (
        <Dialog open={isReportModalOpen} onOpenChange={setIsReportModalOpen}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <Wrench className="text-teal-600" size={20} /> Report Damaged Seat
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Submit an issue report to temporarily disable seat for new bookings.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleReportMaintenance} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Select Seat Number</label>
                <select
                  value={seatNumber}
                  onChange={(e) => setSeatNumber(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3 focus:border-teal-600"
                >
                  <option value="">-- Choose Seat --</option>
                  {seats.map(s => (
                    <option key={s.id} value={s.seatNumber}>Seat {s.seatNumber} ({s.floorName || 'Ground Floor'})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Issue Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3 focus:border-teal-600"
                >
                  <option value="Broken Frame / Cushion">Broken Frame / Cushion</option>
                  <option value="Power Outlet Defective">Power Outlet Defective</option>
                  <option value="Desk Surface Scratched / Damaged">Desk Surface Scratched / Damaged</option>
                  <option value="Reading Lamp Faulty">Reading Lamp Faulty</option>
                  <option value="Other">Other Operational Damage</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Description</label>
                <Input
                  type="text"
                  placeholder="e.g., Cushion torn, power port loose..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High (Urgent)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Resolution Timeline</label>
                  <select
                    value={expectedResolution}
                    onChange={(e) => setExpectedResolution(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                  >
                    <option value="Within 24 Hours">Within 24 Hours</option>
                    <option value="Within 48 Hours">Within 48 Hours</option>
                    <option value="1 Week">1 Week</option>
                  </select>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2"
              >
                {loading ? 'Submitting...' : 'Submit Report & Flag Seat →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
