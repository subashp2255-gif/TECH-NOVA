import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Cpu, RefreshCw, CheckCircle2, Play, Power } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AutomationRulesPage() {
  const { user: adminUser } = useAuth();
  const [rules, setRules] = useState([
    { id: 'AUTO-01', name: 'No-Show Grace Auto-Release', trigger: 'Every 5 Mins', action: 'Release seat & log offense if grace > 15 mins', enabled: true, lastRun: '2 mins ago' },
    { id: 'AUTO-02', name: 'Waitlist Auto-Allocation', trigger: 'On Seat Release', action: 'Dispatch instant seat offer to FIFO waitlist queue', enabled: true, lastRun: '10 mins ago' },
    { id: 'AUTO-03', name: 'Waitlist Offer Expiration', trigger: 'Every 5 Mins', action: 'Expire uncollected waitlist claims after 10 mins', enabled: true, lastRun: '5 mins ago' },
    { id: 'AUTO-04', name: 'Occupancy Threshold Alert', trigger: 'On Check-In', action: 'Alert staff if library occupancy exceeds 90%', enabled: true, lastRun: '1 hour ago' }
  ]);

  const toggleRule = (ruleId) => {
    setRules(prev => prev.map(r => {
      if (r.id === ruleId) {
        const updated = !r.enabled;
        toast.success(`Automation rule ${r.name} ${updated ? 'ENABLED' : 'DISABLED'}.`);
        return { ...r, enabled: updated };
      }
      return r;
    }));
  };

  const handleRunNow = (ruleName) => {
    adminService.logAudit({
      userName: adminUser?.name || 'Administrator',
      action: 'AUTOMATION_MANUAL_TRIGGER',
      affectedRecord: `Rule: ${ruleName}`,
      result: 'SUCCESS',
      notes: 'Executed manual rule pass'
    });
    toast.success(`Automation runner pass completed for "${ruleName}".`);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Cpu className="text-indigo-600" size={28} /> Automated Rules & Cron Engine
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Configure automated background tasks for grace period releases, waitlist allocations, and occupancy alerts.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {rules.map(rule => (
          <Card key={rule.id} className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 font-mono text-[10px]">
                    {rule.id}
                  </Badge>
                  <h3 className="text-base font-extrabold text-navy">{rule.name}</h3>
                </div>
                <p className="text-xs text-slate-600 mt-1 font-sans">{rule.action}</p>
                <p className="text-[11px] text-slate-500 font-mono mt-1">Trigger: {rule.trigger} • Last Execution: {rule.lastRun}</p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={() => handleRunNow(rule.name)}
                  variant="outline"
                  className="border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl h-9 px-3 flex items-center gap-1.5"
                >
                  <Play size={14} /> Run Now
                </Button>
                <Button
                  onClick={() => toggleRule(rule.id)}
                  className={`h-9 px-4 text-xs font-bold rounded-xl ${
                    rule.enabled ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                  }`}
                >
                  {rule.enabled ? 'Active' : 'Disabled'}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
