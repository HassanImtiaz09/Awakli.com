import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { motion } from "framer-motion";
import { useState } from "react";
import {
  DollarSign, Users, Clock, CheckCircle2, AlertCircle,
  ArrowRight, Package, Truck, CreditCard, FileText,
  ChevronDown, ExternalLink, Search, Filter,
} from "lucide-react";
import { PlatformLayout } from "@/components/awakli/Layouts";
import { toast } from "sonner";

type Tab = "summary" | "pending" | "orders";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    approved: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    paid: "bg-green-500/10 text-green-400 border-green-500/20",
    failed: "bg-red-500/10 text-red-400 border-red-500/20",
    payment_pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    submitted_to_lulu: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    production: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    shipped: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    delivered: "bg-green-500/10 text-green-400 border-green-500/20",
    cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/20",
    refunded: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  };

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${colors[status] ?? "bg-gray-500/10 text-gray-400 border-gray-500/20"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────

function PayoutSummaryTab() {
  const summary = trpc.adminPrint.getPayoutSummary.useQuery();

  if (summary.isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 rounded-xl bg-white/5 animate-pulse" />
        ))}
      </div>
    );
  }

  const data = summary.data ?? [];
  const totalPending = data.reduce((s, r) => s + r.pendingAmountCents, 0);
  const totalPaid = data.reduce((s, r) => s + r.paidAmountCents, 0);

  return (
    <div>
      {/* Aggregate Stats */}
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <div className="p-5 rounded-xl border border-white/5 bg-[#0D0D1A]">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-yellow-400" />
            <span className="text-sm text-gray-400">Total Pending</span>
          </div>
          <p className="text-2xl font-display font-bold text-yellow-400">{formatCents(totalPending)}</p>
          <p className="text-xs text-gray-500 mt-1">{data.filter(d => d.pendingCount > 0).length} creators awaiting payout</p>
        </div>
        <div className="p-5 rounded-xl border border-white/5 bg-[#0D0D1A]">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <span className="text-sm text-gray-400">Total Paid</span>
          </div>
          <p className="text-2xl font-display font-bold text-green-400">{formatCents(totalPaid)}</p>
          <p className="text-xs text-gray-500 mt-1">all time</p>
        </div>
        <div className="p-5 rounded-xl border border-white/5 bg-[#0D0D1A]">
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-5 h-5 text-token-violet" />
            <span className="text-sm text-gray-400">Active Creators</span>
          </div>
          <p className="text-2xl font-display font-bold text-white">{data.length}</p>
          <p className="text-xs text-gray-500 mt-1">with print royalties</p>
        </div>
      </div>

      {/* Per-Creator Table */}
      {data.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-white/5 bg-[#0D0D1A]">
          <DollarSign className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No creator payouts yet. Payouts are created when print orders ship.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
          <div className="p-4 border-b border-white/5">
            <h3 className="text-sm font-semibold text-white">Creator Balances</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-gray-500 text-xs uppercase">
                  <th className="px-4 py-3 text-left">Creator</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-right">Pending</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right"># Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.map((row) => (
                  <tr key={row.creatorUserId} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 text-white font-medium">{row.creatorName ?? `User #${row.creatorUserId}`}</td>
                    <td className="px-4 py-3 text-gray-400">{row.creatorEmail ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-yellow-400 font-semibold">{formatCents(row.pendingAmountCents)}</td>
                    <td className="px-4 py-3 text-right text-green-400">{formatCents(row.paidAmountCents)}</td>
                    <td className="px-4 py-3 text-right text-gray-400">{row.pendingCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Payout Instructions */}
      <div className="mt-8 p-6 rounded-2xl border border-token-cyan/20 bg-token-cyan/5">
        <div className="flex items-start gap-4">
          <FileText className="w-6 h-6 text-token-cyan mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Manual Payout Process</h3>
            <ol className="text-sm text-gray-400 leading-relaxed space-y-1 list-decimal list-inside">
              <li>Go to the "Pending" tab and approve payouts for a creator</li>
              <li>Open <a href="https://dashboard.stripe.com/test/transfers" target="_blank" rel="noopener" className="text-token-cyan hover:underline inline-flex items-center gap-1">Stripe Dashboard → Transfers <ExternalLink className="w-3 h-3" /></a></li>
              <li>Create a manual transfer for the total approved amount</li>
              <li>Copy the transfer ID (starts with <code className="px-1 py-0.5 rounded bg-white/5 text-xs">tr_</code>)</li>
              <li>Return here and mark the payouts as "Paid" with the transfer ID</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pending Payouts Tab ──────────────────────────────────────────────────────

function PendingPayoutsTab() {
  const pending = trpc.adminPrint.getPendingPayouts.useQuery();
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<number[]>([]);
  const [transferId, setTransferId] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [showMarkPaid, setShowMarkPaid] = useState(false);

  const approveMutation = trpc.adminPrint.approvePayouts.useMutation({
    onSuccess: (data) => {
      toast.success(`Approved ${data.approved} payout(s)`);
      setSelected([]);
      utils.adminPrint.getPendingPayouts.invalidate();
      utils.adminPrint.getPayoutSummary.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const markPaidMutation = trpc.adminPrint.markPaid.useMutation({
    onSuccess: (data) => {
      toast.success(`Marked ${data.paid} payout(s) as paid`);
      setSelected([]);
      setTransferId("");
      setAdminNotes("");
      setShowMarkPaid(false);
      utils.adminPrint.getPendingPayouts.invalidate();
      utils.adminPrint.getPayoutSummary.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (pending.isLoading) {
    return <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}</div>;
  }

  const data = pending.data ?? [];

  const toggleSelect = (id: number) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selected.length === data.length) setSelected([]);
    else setSelected(data.map(d => d.id));
  };

  return (
    <div>
      {/* Actions Bar */}
      {selected.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-4 rounded-xl border border-token-violet/20 bg-token-violet/5 flex items-center gap-4 flex-wrap"
        >
          <span className="text-sm text-white font-semibold">{selected.length} selected</span>
          <span className="text-sm text-gray-400">
            Total: {formatCents(data.filter(d => selected.includes(d.id)).reduce((s, d) => s + d.amountCents, 0))}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => approveMutation.mutate({ payoutIds: selected })}
              disabled={approveMutation.isPending}
              className="px-4 py-2 rounded-lg bg-blue-500/10 text-blue-400 text-sm font-semibold border border-blue-500/20 hover:bg-blue-500/20 transition-all disabled:opacity-50"
            >
              {approveMutation.isPending ? "Approving..." : "Approve Selected"}
            </button>
            <button
              onClick={() => setShowMarkPaid(true)}
              className="px-4 py-2 rounded-lg bg-green-500/10 text-green-400 text-sm font-semibold border border-green-500/20 hover:bg-green-500/20 transition-all"
            >
              Mark as Paid
            </button>
          </div>
        </motion.div>
      )}

      {/* Mark Paid Dialog */}
      {showMarkPaid && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-6 rounded-xl border border-green-500/20 bg-[#0D0D1A]"
        >
          <h4 className="text-sm font-semibold text-white mb-4">Record Stripe Transfer</h4>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Stripe Transfer ID *</label>
              <input
                type="text"
                value={transferId}
                onChange={(e) => setTransferId(e.target.value)}
                placeholder="tr_..."
                className="w-full px-3 py-2 rounded-lg bg-[#08080F] border border-white/10 text-white text-sm focus:border-green-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Admin Notes (optional)</label>
              <input
                type="text"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="e.g., Monthly batch payout for May 2026"
                className="w-full px-3 py-2 rounded-lg bg-[#08080F] border border-white/10 text-white text-sm focus:border-white/20 focus:outline-none"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  if (!transferId.trim()) {
                    toast.error("Stripe transfer ID is required");
                    return;
                  }
                  markPaidMutation.mutate({
                    payoutIds: selected,
                    stripeTransferId: transferId.trim(),
                    adminNotes: adminNotes.trim() || undefined,
                  });
                }}
                disabled={markPaidMutation.isPending}
                className="px-4 py-2 rounded-lg bg-green-500 text-white text-sm font-semibold hover:bg-green-600 transition-all disabled:opacity-50"
              >
                {markPaidMutation.isPending ? "Processing..." : "Confirm Payment"}
              </button>
              <button
                onClick={() => setShowMarkPaid(false)}
                className="px-4 py-2 rounded-lg border border-white/10 text-gray-400 text-sm hover:text-white transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Table */}
      {data.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-white/5 bg-[#0D0D1A]">
          <CheckCircle2 className="w-10 h-10 text-green-500/50 mx-auto mb-3" />
          <p className="text-gray-500">No pending payouts. All creators are paid up!</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-gray-500 text-xs uppercase">
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selected.length === data.length && data.length > 0}
                      onChange={selectAll}
                      className="rounded border-gray-600"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">Creator</th>
                  <th className="px-4 py-3 text-left">Order</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.map((payout) => (
                  <tr key={payout.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(payout.id)}
                        onChange={() => toggleSelect(payout.id)}
                        className="rounded border-gray-600"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{payout.creatorName ?? "Unknown"}</p>
                      <p className="text-xs text-gray-500">{payout.creatorEmail ?? ""}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-400">#{payout.printOrderId}</td>
                    <td className="px-4 py-3 text-right text-yellow-400 font-semibold">{formatCents(payout.amountCents)}</td>
                    <td className="px-4 py-3"><StatusBadge status={payout.status} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {payout.createdAt ? new Date(payout.createdAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────

function PrintOrdersTab() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const orders = trpc.adminPrint.getAllOrders.useQuery({ status: statusFilter || undefined, limit: 50 });
  const utils = trpc.useUtils();

  const submitToLulu = trpc.adminPrint.submitToLulu.useMutation({
    onSuccess: (data) => {
      toast.success(`Submitted to Lulu (Job #${data.luluPrintJobId})`);
      utils.adminPrint.getAllOrders.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (orders.isLoading) {
    return <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}</div>;
  }

  const { orders: data = [], total = 0 } = orders.data ?? {};

  return (
    <div>
      {/* Filter */}
      <div className="mb-4 flex items-center gap-3">
        <Filter className="w-4 h-4 text-gray-500" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#0D0D1A] border border-white/10 text-white text-sm focus:border-token-violet/50 focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="payment_pending">Payment Pending</option>
          <option value="paid">Paid</option>
          <option value="submitted_to_lulu">Submitted to Lulu</option>
          <option value="production">In Production</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <span className="text-xs text-gray-500">{total} total orders</span>
      </div>

      {data.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-white/5 bg-[#0D0D1A]">
          <Package className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No print orders yet.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-gray-500 text-xs uppercase">
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Tracking</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.map((order: any) => (
                  <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 text-white font-mono">#{order.id}</td>
                    <td className="px-4 py-3 text-gray-400">User #{order.userId}</td>
                    <td className="px-4 py-3">
                      <p className="text-white text-xs">{order.trimSize?.toUpperCase()} {order.luluPackageId?.includes("FC") ? "Color" : "B&W"}</p>
                      <p className="text-gray-500 text-xs">{order.pageCount} pages × {order.quantity}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-white font-semibold">{formatCents(order.totalPriceCents ?? 0)}</td>
                    <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                    <td className="px-4 py-3">
                      {order.trackingNumber ? (
                        <a href={order.trackingUrl || "#"} target="_blank" rel="noopener" className="text-token-cyan text-xs hover:underline inline-flex items-center gap-1">
                          {order.trackingNumber} <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {order.status === "paid" && (
                        <button
                          onClick={() => submitToLulu.mutate({ orderId: order.id })}
                          disabled={submitToLulu.isPending}
                          className="px-2 py-1 rounded text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-all disabled:opacity-50"
                        >
                          Submit to Lulu
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminPrintPayouts() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("summary");

  if (user?.role !== "admin") {
    return (
      <PlatformLayout>
        <div className="container py-32 text-center">
          <AlertCircle className="w-12 h-12 text-red-500/50 mx-auto mb-4" />
          <h2 className="text-2xl font-heading font-bold text-white mb-3">Access Denied</h2>
          <p className="text-gray-400">Admin access required to view print payouts.</p>
        </div>
      </PlatformLayout>
    );
  }

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: "summary", label: "Summary", icon: DollarSign },
    { key: "pending", label: "Pending Payouts", icon: Clock },
    { key: "orders", label: "Print Orders", icon: Package },
  ];

  return (
    <PlatformLayout>
      <div className="container py-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2">Print Payouts</h1>
            <p className="text-gray-400">Manage creator royalties from print orders. Manual payout workflow.</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-8 p-1 rounded-xl bg-[#0D0D1A] border border-white/5 w-fit">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === key
                    ? "bg-token-violet/10 text-token-violet border border-token-violet/20"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {tab === "summary" && <PayoutSummaryTab />}
          {tab === "pending" && <PendingPayoutsTab />}
          {tab === "orders" && <PrintOrdersTab />}
        </motion.div>
      </div>
    </PlatformLayout>
  );
}
