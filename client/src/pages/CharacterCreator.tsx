import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Plus, User, Sparkles, Loader2, Trash2, Edit3,
  Palette, Eye, X, Check, RefreshCw, Image as ImageIcon,
} from "lucide-react";
import MultiViewReferenceSheet from "@/components/awakli/MultiViewReferenceSheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import LoraTrainingCard from "@/components/awakli/LoraTrainingCard";

// ─── Constants ────────────────────────────────────────────────────────────

const ROLES = [
  { id: "protagonist" as const, label: "Protagonist", color: "#7C4DFF" },
  { id: "antagonist" as const,  label: "Antagonist",  color: "#E74C3C" },
  { id: "supporting" as const,  label: "Supporting",  color: "#E040FB" },
  { id: "background" as const,  label: "Background",  color: "#5C5C7A" },
] as const;

const BODY_TYPES = ["Slim", "Athletic", "Average", "Muscular", "Petite", "Tall", "Stocky"] as const;

const PERSONALITY_SUGGESTIONS = [
  "Brave", "Cunning", "Gentle", "Hot-headed", "Mysterious", "Cheerful",
  "Stoic", "Sarcastic", "Loyal", "Ambitious", "Shy", "Charismatic",
  "Ruthless", "Compassionate", "Eccentric", "Wise", "Naive", "Rebellious",
];

// ─── Character Card ───────────────────────────────────────────────────────

function CharacterCard({
  character,
  onEdit,
  onDelete,
}: {
  character: {
    id: number;
    name: string;
    role: string;
    referenceSheetUrl: string | null;
    visualTraits: any;
    personalityTraits: string | null;
  };
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const roleConfig = ROLES.find(r => r.id === character.role) || ROLES[3];
  const traits = character.visualTraits as Record<string, string> | null;

  return (
    <motion.div
      className="relative aspect-[3/4] rounded-xl border border-white/10 overflow-hidden group cursor-pointer"
      style={{ background: "var(--gradient-card)" }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      whileHover={{ y: -4, boxShadow: "var(--shadow-card)" }}
      onClick={onEdit}
      layout
    >
      {/* Image or placeholder */}
      {character.referenceSheetUrl ? (
        <img
          src={character.referenceSheetUrl}
          alt={character.name}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-elevated)]">
          <div className="text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-2xl font-heading font-bold"
              style={{ backgroundColor: `${roleConfig.color}20`, color: roleConfig.color }}
            >
              {character.name.slice(0, 2).toUpperCase()}
            </div>
          </div>
        </div>
      )}

      {/* Bottom gradient overlay */}
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[var(--bg-void)] via-[var(--bg-void)]/60 to-transparent" />

      {/* Content */}
      <div className="absolute inset-x-0 bottom-0 p-4 space-y-2">
        <h3 className="text-lg font-heading font-semibold text-[var(--text-primary)]">{character.name}</h3>
        <span
          className="inline-block px-2 py-0.5 rounded-md text-[10px] font-medium capitalize"
          style={{ backgroundColor: `${roleConfig.color}20`, color: roleConfig.color }}
        >
          {character.role}
        </span>
        {traits && (
          <div className="flex flex-wrap gap-1 mt-1">
            {traits.hairColor && (
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-white/10 text-[var(--text-muted)]">
                {traits.hairColor} hair
              </span>
            )}
            {traits.eyeColor && (
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-white/10 text-[var(--text-muted)]">
                {traits.eyeColor} eyes
              </span>
            )}
          </div>
        )}
      </div>

      {/* Hover actions */}
      <AnimatePresence>
        {showActions && (
          <motion.div
            className="absolute top-3 right-3 flex gap-2"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-2 rounded-lg bg-[var(--bg-void)]/80 text-[var(--text-primary)] hover:bg-[var(--token-cyan)]/20 transition-colors backdrop-blur-sm"
            >
              <Edit3 size={14} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-2 rounded-lg bg-[var(--bg-void)]/80 text-[var(--status-error)] hover:bg-[var(--status-error)]/20 transition-colors backdrop-blur-sm"
            >
              <Trash2 size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Character Form Modal ─────────────────────────────────────────────────

function CharacterFormModal({
  open,
  onClose,
  projectId,
  editCharacter,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  editCharacter?: any;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editCharacter?.name || "");
  const [role, setRole] = useState<string>(editCharacter?.role || "protagonist");
  const [personalityTraits, setPersonalityTraits] = useState<string[]>(
    editCharacter?.personalityTraits ? editCharacter.personalityTraits.split(", ") : []
  );
  const [traitInput, setTraitInput] = useState("");
  const [hairColor, setHairColor] = useState(editCharacter?.visualTraits?.hairColor || "");
  const [eyeColor, setEyeColor] = useState(editCharacter?.visualTraits?.eyeColor || "");
  const [bodyType, setBodyType] = useState(editCharacter?.visualTraits?.bodyType || "Average");
  const [clothing, setClothing] = useState(editCharacter?.visualTraits?.clothing || "");
  const [features, setFeatures] = useState(editCharacter?.visualTraits?.distinguishingFeatures || "");
  const [generatingRef, setGeneratingRef] = useState(false);
  const [refSheetUrl, setRefSheetUrl] = useState<string | null>(editCharacter?.referenceSheetUrl || null);

  const createMutation = trpc.characters.create.useMutation();
  const updateMutation = trpc.characters.update.useMutation();
  const generateRefMutation = trpc.characters.generateReference.useMutation();

  const addTrait = (trait: string) => {
    const t = trait.trim();
    if (t && !personalityTraits.includes(t)) {
      setPersonalityTraits([...personalityTraits, t]);
    }
    setTraitInput("");
  };

  const removeTrait = (trait: string) => {
    setPersonalityTraits(personalityTraits.filter(t => t !== trait));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Character name is required");
      return;
    }
    const visualTraits = { hairColor, eyeColor, bodyType, clothing, distinguishingFeatures: features };
    const data = {
      name: name.trim(),
      role: role as any,
      personalityTraits: personalityTraits.length > 0 ? personalityTraits : undefined,
      visualTraits,
      // referenceSheetUrl is set by the generateReference procedure, not directly
    };

    try {
      if (editCharacter) {
        await updateMutation.mutateAsync({ id: editCharacter.id, ...data });
        toast.success("Character updated!");
      } else {
        await createMutation.mutateAsync({ projectId, ...data });
        toast.success("Character created!");
      }
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to save character");
    }
  };

  const handleGenerateRef = async () => {
    if (!name.trim()) {
      toast.error("Enter a name first");
      return;
    }
    setGeneratingRef(true);
    try {
      const characterId = editCharacter?.id;
      if (!characterId) {
        // Save first, then generate
        const result = await createMutation.mutateAsync({
          projectId,
          name: name.trim(),
          role: role as any,
          personalityTraits: personalityTraits.length > 0 ? personalityTraits : undefined,
          visualTraits: { hairColor, eyeColor, bodyType, clothing, distinguishingFeatures: features },
        });
        const genResult = await generateRefMutation.mutateAsync({ characterId: result.id });
        setRefSheetUrl(genResult.url ?? null);
        toast.success("Reference sheet generated!");
        onSaved();
      } else {
        const genResult = await generateRefMutation.mutateAsync({ characterId });
        setRefSheetUrl(genResult.url ?? null);
        toast.success("Reference sheet generated!");
        onSaved();
      }
    } catch {
      toast.error("Failed to generate reference sheet");
    } finally {
      setGeneratingRef(false);
    }
  };

  // Build preview text
  const previewText = [
    name && `**${name}**`,
    role && `Role: ${ROLES.find(r => r.id === role)?.label}`,
    personalityTraits.length > 0 && `Personality: ${personalityTraits.join(", ")}`,
    hairColor && `Hair: ${hairColor}`,
    eyeColor && `Eyes: ${eyeColor}`,
    bodyType && `Build: ${bodyType}`,
    clothing && `Outfit: ${clothing}`,
    features && `Features: ${features}`,
  ].filter(Boolean).join("\n");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[var(--bg-elevated)] border-white/10 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)] font-heading">
            {editCharacter ? "Edit Character" : "Add Character"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          {/* Left: Form */}
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="text-label text-[var(--text-muted)] mb-1.5 block">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Character name..."
                className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-overlay)] border border-white/10 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--token-cyan)]/40 text-lg"
              />
            </div>

            {/* Role */}
            <div>
              <label className="text-label text-[var(--text-muted)] mb-1.5 block">Role</label>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map((r) => (
                  <motion.button
                    key={r.id}
                    onClick={() => setRole(r.id)}
                    className={cn(
                      "px-3 py-2 rounded-lg text-sm font-medium border transition-all text-center",
                      role === r.id
                        ? "border-transparent"
                        : "border-white/10 hover:border-white/20"
                    )}
                    style={{
                      backgroundColor: role === r.id ? `${r.color}20` : "var(--bg-overlay)",
                      color: role === r.id ? r.color : "var(--text-secondary)",
                    }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {r.label}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Personality Traits */}
            <div>
              <label className="text-label text-[var(--text-muted)] mb-1.5 block">Personality Traits</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {personalityTraits.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-[var(--token-cyan)]/15 text-[var(--token-cyan)]"
                  >
                    {t}
                    <button onClick={() => removeTrait(t)} className="hover:text-white">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={traitInput}
                  onChange={(e) => setTraitInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTrait(traitInput); } }}
                  placeholder="Add trait..."
                  className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-overlay)] border border-white/10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--token-cyan)]/40"
                />
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {PERSONALITY_SUGGESTIONS.filter(s => !personalityTraits.includes(s)).slice(0, 8).map((s) => (
                  <button
                    key={s}
                    onClick={() => addTrait(s)}
                    className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-secondary)] transition-colors"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Visual Traits */}
            <div className="space-y-3">
              <label className="text-label text-[var(--text-muted)] block">Visual Traits</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] mb-1 block">Hair Color</span>
                  <input
                    type="text"
                    value={hairColor}
                    onChange={(e) => setHairColor(e.target.value)}
                    placeholder="e.g. Silver"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-overlay)] border border-white/10 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--token-cyan)]/40"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] mb-1 block">Eye Color</span>
                  <input
                    type="text"
                    value={eyeColor}
                    onChange={(e) => setEyeColor(e.target.value)}
                    placeholder="e.g. Crimson"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-overlay)] border border-white/10 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--token-cyan)]/40"
                  />
                </div>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] mb-1 block">Body Type</span>
                <div className="flex flex-wrap gap-1.5">
                  {BODY_TYPES.map((bt) => (
                    <button
                      key={bt}
                      onClick={() => setBodyType(bt)}
                      className={cn(
                        "px-2 py-1 rounded-md text-[10px] font-medium border transition-all",
                        bodyType === bt
                          ? "bg-[var(--token-cyan)]/15 border-[var(--token-cyan)]/30 text-[var(--token-cyan)]"
                          : "bg-[var(--bg-overlay)] border-white/10 text-[var(--text-muted)] hover:border-white/20"
                      )}
                    >
                      {bt}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] mb-1 block">Clothing</span>
                <input
                  type="text"
                  value={clothing}
                  onChange={(e) => setClothing(e.target.value)}
                  placeholder="e.g. Dark trench coat, combat boots"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-overlay)] border border-white/10 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--token-cyan)]/40"
                />
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] mb-1 block">Distinguishing Features</span>
                <input
                  type="text"
                  value={features}
                  onChange={(e) => setFeatures(e.target.value)}
                  placeholder="e.g. Scar across left eye, glowing tattoos"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-overlay)] border border-white/10 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--token-cyan)]/40"
                />
              </div>
            </div>
          </div>

          {/* Right: Preview & Reference */}
          <div className="space-y-4">
            {/* Text preview */}
            <div className="rounded-xl border border-white/10 bg-[var(--bg-overlay)] p-4">
              <h4 className="text-xs font-medium text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <Eye size={12} />
                Character Preview
              </h4>
              <div className="text-sm text-[var(--text-secondary)] whitespace-pre-line space-y-1">
                {name ? (
                  <>
                    <p className="text-lg font-heading font-semibold text-[var(--text-primary)]">{name}</p>
                    <p className="text-xs capitalize" style={{ color: ROLES.find(r => r.id === role)?.color }}>
                      {ROLES.find(r => r.id === role)?.label}
                    </p>
                    {personalityTraits.length > 0 && (
                      <p className="text-xs text-[var(--text-muted)] mt-2">
                        <span className="text-[var(--text-secondary)]">Personality:</span> {personalityTraits.join(", ")}
                      </p>
                    )}
                    {(hairColor || eyeColor) && (
                      <p className="text-xs text-[var(--text-muted)]">
                        {hairColor && <span>{hairColor} hair</span>}
                        {hairColor && eyeColor && " · "}
                        {eyeColor && <span>{eyeColor} eyes</span>}
                      </p>
                    )}
                    {bodyType && <p className="text-xs text-[var(--text-muted)]">Build: {bodyType}</p>}
                    {clothing && <p className="text-xs text-[var(--text-muted)]">Outfit: {clothing}</p>}
                    {features && <p className="text-xs text-[var(--text-muted)]">Features: {features}</p>}
                  </>
                ) : (
                  <p className="text-[var(--text-muted)] italic">Fill in the form to see a preview...</p>
                )}
              </div>
            </div>

            {/* Multi-View Reference Sheet (Wave 2 D0 Character Designer) */}
            <div className="rounded-xl border border-white/10 bg-[var(--bg-overlay)] p-4">
              {editCharacter?.id ? (
                <MultiViewReferenceSheet
                  characterId={editCharacter.id}
                  projectId={projectId}
                  characterName={name || editCharacter.name}
                  onApproved={() => {
                    toast.success("Character reference sheet locked for pipeline!");
                    onSaved();
                  }}
                />
              ) : (
                <div className="text-center py-6">
                  <Palette size={32} className="mx-auto text-[var(--text-muted)] mb-2" />
                  <p className="text-xs text-[var(--text-muted)]">Save the character first to generate multi-view reference sheet</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-white/5">
          <Button variant="outline" onClick={onClose} className="border-white/10 text-[var(--text-secondary)]">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={createMutation.isPending || updateMutation.isPending || !name.trim()}
            className="bg-[var(--token-cyan)] text-[var(--bg-void)] hover:bg-[var(--token-cyan-hover)]"
          >
            {(createMutation.isPending || updateMutation.isPending) && <Loader2 size={14} className="animate-spin mr-2" />}
            {editCharacter ? "Update" : "Create"} Character
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function CharacterCreator() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  const [modalOpen, setModalOpen] = useState(false);
  const [editChar, setEditChar] = useState<any>(null);

  const { data: characters, isLoading, refetch } = trpc.characters.listByProject.useQuery({ projectId });
  const deleteMutation = trpc.characters.delete.useMutation();

  const handleEdit = (char: any) => {
    setEditChar(char);
    setModalOpen(true);
  };

  const handleAdd = () => {
    setEditChar(null);
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this character?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success("Character deleted");
      refetch();
    } catch {
      toast.error("Failed to delete character");
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h2 text-[var(--text-primary)]">Characters</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Create and manage your story's cast
          </p>
        </div>
        <motion.button
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-[var(--token-cyan)] text-white hover:bg-[var(--token-violet-hover)] transition-colors"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Plus size={16} />
          Add Character
        </motion.button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="aspect-[3/4] rounded-xl skeleton-shimmer" />
          ))}
        </div>
      ) : !characters?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <User size={48} className="text-[var(--text-muted)] mb-4" />
          <h3 className="text-lg font-heading text-[var(--text-secondary)]">No characters yet</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">
            Create your first character to start building your story's cast. Add visual traits and generate AI reference sheets.
          </p>
          <motion.button
            onClick={handleAdd}
            className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-[var(--token-cyan)] text-white hover:bg-[var(--token-violet-hover)] transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Plus size={16} />
            Create First Character
          </motion.button>
        </div>
      ) : (
        <motion.div
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.08 } },
          }}
        >
          {characters.map((char) => (
            <motion.div
              key={char.id}
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0 },
              }}
            >
              <CharacterCard
                character={{
                  id: char.id,
                  name: char.name,
                  role: char.role,
                  referenceSheetUrl: (char as any).referenceSheetUrl ?? null,
                  visualTraits: char.visualTraits,
                  personalityTraits: typeof char.personalityTraits === 'string' ? char.personalityTraits : null,
                }}
                onEdit={() => handleEdit(char)}
                onDelete={() => handleDelete(char.id)}
              />
            </motion.div>
          ))}

          {/* Add card */}
          <motion.button
            onClick={handleAdd}
            className="aspect-[3/4] rounded-xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--token-cyan)]/30 transition-all"
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0 },
            }}
            whileHover={{ scale: 1.02, borderColor: "var(--token-cyan)" }}
          >
            <Plus size={32} />
            <span className="text-sm font-medium">Add Character</span>
          </motion.button>
        </motion.div>
      )}

      {/* LoRA Training Section */}
      {characters && characters.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-heading text-[var(--text-primary)] flex items-center gap-2">
            <Sparkles size={18} className="text-token-cyan" />
            LoRA Training
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Train character-specific LoRA models to improve consistency in generated panels.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {characters.map((char) => (
              <div key={char.id}>
                <div className="text-sm font-medium text-white mb-2">{char.name}</div>
                <LoraTrainingCard
                  characterId={char.id}
                  characterName={char.name}
                  loraStatus={(char as any).loraStatus ?? null}
                  loraModelUrl={(char as any).loraModelUrl ?? null}
                  loraTriggerWord={(char as any).loraTriggerWord ?? null}
                  onStatusChange={() => refetch()}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Character form modal */}
      <CharacterFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditChar(null); }}
        projectId={projectId}
        editCharacter={editChar}
        onSaved={() => refetch()}
      />
    </div>
  );
}
