// src/store/useTasks.ts
import { create } from 'zustand';
import storage from '../storage';
import i18n from '../i18n';

export type TaskCategory = 'Genel' | 'Okul' | 'İş' | 'Sağlık' | 'Aile' | 'Sosyal';
export type TaskPriority = 'Düşük' | 'Orta' | 'Yüksek';

// Görevin kime ait olduğunu anlatan kaynak
export type TaskOrigin = 'given' | 'self' | 'legacy';

// Görev zamanı (gün içi)
export type TaskTimeOfDay = 'sabah' | 'öğlen' | 'akşam' | 'özel';

// Tekrarlama tipi
export type TaskRepeatType = 'none' | 'daily' | 'weekly' | 'custom';

// 🔥 Zamanlama/schedule tipi – UI’daki when/repeat/reminder’ı modelleyelim
export type TaskScheduleWhen = 'today' | 'tomorrow' | 'thisWeek';
export type TaskScheduleRepeat = 'none' | 'daily' | 'weekly';

export type TaskSchedule = {
  when?: TaskScheduleWhen;
  repeat?: TaskScheduleRepeat;
  reminder?: boolean;
};

// Görev ana tipi – eski alanlar + yeni alanlar
export type Task = {
  id: string;
  title: string;
  done: boolean; // eski alan – UI bunu kullanıyor olabilir
  ts: number; // oluşturulma zamanı

  category?: TaskCategory;
  priority?: TaskPriority;

  // 🔥 Yeni: görev açıklaması
  description?: string;

  // 🔥 Yeni: görev kaynağı (görev ver / görev ekle / eski kayıt)
  origin?: TaskOrigin;

  // 🔥 Yeni: hazır görev şablonu id'si (varsayılan: null)
  templateId?: string | null;

  // 🔥 Yeni: zamanlama / planlama alanları
  dueDate?: number | null; // tek seferlik son tarih (ms)
  timeOfDay?: TaskTimeOfDay; // sabah / öğlen / akşam / özel

  repeatType?: TaskRepeatType; // none / daily / weekly / custom
  repeatDaysOfWeek?: number[]; // [1,3,5] = Pazartesi, Çarşamba, Cuma
  repeatStartDate?: number | null; // tekrarlayan görev için başlangıç
  repeatEndDate?: number | null; // tekrarlayan görev için bitiş

  // 🔥 Schedule bilgisi (Görev Ekle ekranındaki today/tomorrow/thisWeek + repeat + reminder)
  schedule?: TaskSchedule;

  // 🔥 Yeni: görev durumu (done ile uyumlu tutulacak)
  status?: 'pending' | 'done' | 'skipped' | 'expired';

  // 🔥 Tamamlanma zamanı (streak / seviye hesapları için)
  completedAt?: number;

  // 🔥 Görevi değiştirme hakkı için alanlar (şimdilik sadece model – kuralı sonra bağlarız)
  lastEditAt?: number | null; // en son ne zaman düzenlendi
  editsTodayCount?: number; // bugün kaç defa düzenlendi

  // 🔥 Grup / arkadaş görevleri (Pro tarafı)
  isGroupTask?: boolean;
  assignedByUserId?: string | null;
  assignedToUserIds?: string[];
  requiresPro?: boolean;
};

// Hazır görev template modeli
export interface TaskTemplate {
  id: string;
  category: TaskCategory;
  title: string; // TR fallback
  description?: string; // TR fallback
  suggestedRepeat?: TaskRepeatType;
}

// İlk versiyon için genişletilmiş hazır görev listesi
// ⚠️ Buradaki title/description sadece TÜRKÇE yedek metin.
// Asıl görünen metin i18n'deki tasks.templates[templateId].title / .description’dan alınacak.
export const TASK_TEMPLATES: TaskTemplate[] = [
  // GENEL – odak & üretkenlik
  {
    id: 'focus-25min',
    category: 'Genel',
    title: '25 dakika odaklan',
    description: 'Telefonu sessize al, tek bir işe 25 dakika boyunca odaklan.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'focus-deep-clean',
    category: 'Genel',
    title: 'Masa / çalışma alanı mini temizlik',
    description:
      'Masandaki gereksizleri topla, 10 dakikalık “sıfırdan başla” etkisi yarat.',
    suggestedRepeat: 'weekly',
  },
  {
    id: 'focus-inbox-zero',
    category: 'Genel',
    title: 'Gelen kutunu hafiflet',
    description: 'Bugün en az 5 gereksiz maili sil ya da arşivle.',
    suggestedRepeat: 'weekly',
  },
  {
    id: 'focus-no-scroll-20min',
    category: 'Genel',
    title: '20 dakika “scroll yok” kuralı',
    description:
      'Herhangi bir sosyal medya akışında gezinmeden 20 dakika geçir.',
    suggestedRepeat: 'daily',
  },

  // SAĞLIK – hareket, nefes, su
  {
    id: 'health-steps-6000',
    category: 'Sağlık',
    title: 'Gün içinde 6000 adım at',
    description:
      'Dışarıda kısa yürüyüşler planla; toplamda en az 6000 adıma ulaş.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'health-water-6',
    category: 'Sağlık',
    title: 'En az 6 bardak su iç',
    description: 'Su tüketimini gün içine yayarak takip et.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'health-stretch-10',
    category: 'Sağlık',
    title: '10 dakikalık esneme molası',
    description: 'Boyun, omuz ve bel için basit esneme hareketleri yap.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'health-walk-sunset',
    category: 'Sağlık',
    title: 'Akşamüstü mini yürüyüş',
    description: 'Gün batımına yakın 15 dakikalık temiz hava yürüyüşü yap.',
    suggestedRepeat: 'weekly',
  },

  // İŞ – odaklı çalışma
  {
    id: 'work-priority-task',
    category: 'İş',
    title: 'En önemli işi bitir',
    description:
      'Bugünün en önemli işini seç, küçük parçalara böl ve tamamla.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'work-no-meeting-30',
    category: 'İş',
    title: 'Toplantısız 30 dakika blok',
    description:
      'Takviminde 30 dakikalık sessiz odak bloğu aç ve o sırada hiçbir görüşme planlama.',
    suggestedRepeat: 'weekly',
  },
  {
    id: 'work-feedback-ask',
    category: 'İş',
    title: 'Geri bildirim iste',
    description:
      'Yaptığın bir iş için ekip arkadaşından kısa bir geri bildirim rica et.',
    suggestedRepeat: 'weekly',
  },
  {
    id: 'work-small-win-share',
    category: 'İş',
    title: 'Bugünün küçük zaferini not al',
    description:
      'Bugün seni en çok mutlu eden iş / ilerlemeyi bir cümleyle yaz.',
    suggestedRepeat: 'daily',
  },

  // OKUL – ders & öğrenme
  {
    id: 'school-25min-study',
    category: 'Okul',
    title: '25 dakika ders / konu tekrarı',
    description:
      'Sadece tek bir derse odaklan; telefonuna bakmadan 25 dakika çalış.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'school-question-solve',
    category: 'Okul',
    title: 'En az 10 soru çöz',
    description: 'Bugün seçtiğin dersten en az 10 yeni soru çöz.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'school-notes-clean',
    category: 'Okul',
    title: 'Notlarını düzenle',
    description:
      'Defter / dijital notlarında bir konuyu temizle, başlıklar ekle.',
    suggestedRepeat: 'weekly',
  },
  {
    id: 'school-share-tip',
    category: 'Okul',
    title: 'Bir arkadaşına çalışma tüyosu gönder',
    description:
      'Kullandığın bir çalışma tekniğini (Pomodoro, renkli notlar vb.) arkadaşınla paylaş.',
    suggestedRepeat: 'weekly',
  },

  // AİLE – bağ kurma
  {
    id: 'family-call-parent',
    category: 'Aile',
    title: 'Ailenle kısa bir sohbet',
    description:
      'Ebeveynlerinden veya aileden biriyle en az 5 dakikalık samimi bir konuşma yap.',
    suggestedRepeat: 'weekly',
  },
  {
    id: 'family-eat-together',
    category: 'Aile',
    title: 'Beraber yemek',
    description: 'Ailenle aynı masada, telefonsuz bir öğün ye.',
    suggestedRepeat: 'weekly',
  },
  {
    id: 'family-thank-message',
    category: 'Aile',
    title: 'Teşekkür mesajı gönder',
    description:
      'Ailenden birine “iyi ki varsın” tadında kısa bir teşekkür yaz.',
    suggestedRepeat: 'weekly',
  },

  // SOSYAL – Viral ruhu, bağlantı ve paylaşım
  {
    id: 'social-message-friend',
    category: 'Sosyal',
    title: 'Bir arkadaşına mesaj gönder',
    description:
      'Uzun süredir konuşmadığın birine “Nasılsın?” diye sor.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'social-comment-support',
    category: 'Sosyal',
    title: 'Destek yorumu bırak',
    description:
      'Bir arkadaşının paylaşımına içten, destekleyici bir yorum yaz.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'social-share-win',
    category: 'Sosyal',
    title: 'Bugünün “küçük zaferini” paylaş',
    description:
      'Bugün seni mutlu eden küçük bir anı kart olarak kaydetmeye hazırlan.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'social-new-connection',
    category: 'Sosyal',
    title: 'Yeni bir bağlantı kur',
    description:
      'Uzun süredir takip ettiğin ama hiç yazmadığın birine kısa bir merhaba mesajı gönder.',
    suggestedRepeat: 'weekly',
  },
  {
    id: 'social-phone-free-coffee',
    category: 'Sosyal',
    title: 'Telefonsuz kahve / çay molası',
    description:
      'Bir arkadaşınla ya da tek başına, 15 dakikalık kahve molasını telefonsuz geçir.',
    suggestedRepeat: 'weekly',
  },

  // GENEL + SOSYAL – direkt Viral’de içeriğe hazırlık
  {
    id: 'viral-plan-card',
    category: 'Genel',
    title: 'Bir Viral kartı planla',
    description:
      'Bugün paylaşmak isteyeceğin bir anı, not ya da hedef için kart fikri düşün ve başlığını yaz.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'viral-gratitude-3',
    category: 'Genel',
    title: '3 şey için şükret',
    description:
      'Bugün minnettar olduğun 3 şeyi kısa notlar halinde yaz; istersen kartına çevir.',
    suggestedRepeat: 'daily',
  },
  {
    id: 'viral-before-after',
    category: 'Genel',
    title: 'Öncesi / sonrası fotoğraf fikri bul',
    description:
      'Masa düzeni, ekran temizliği, yürüyüş rotası gibi “önce–sonra” gösterebileceğin bir fikir bul.',
    suggestedRepeat: 'weekly',
  },
];

type TasksStats = {
  total: number;
  completed: number;
  active: number;
  level: number;
  completedToday: number;
  currentStreak: number;
  longestStreak: number;
};

// 🔥 Hazır görev “günde 1 kez değiştir” hakkı için meta
type TasksMeta = {
  // Kullanıcı bugün hazır bir görevi değiştirdiyse,
  // o günün dayNumber değeri burada tutulur.
  lastTemplateChangeDay: number | null;
};

// Yeni görev oluştururken kullanılacak opsiyonlar
export type NewTaskOptions = {
  category?: TaskCategory;
  priority?: TaskPriority;
  description?: string;
  origin?: TaskOrigin;
  dueDate?: number | null;
  timeOfDay?: TaskTimeOfDay;
  repeatType?: TaskRepeatType;
  repeatDaysOfWeek?: number[];
  repeatStartDate?: number | null;
  repeatEndDate?: number | null;
  isGroupTask?: boolean;
  assignedByUserId?: string | null;
  assignedToUserIds?: string[];
  requiresPro?: boolean;
  // 🔥 UI’deki schedule bilgisi
  schedule?: TaskSchedule;
};

// Yeni görev payload'ı – title zorunlu
export type NewTaskPayload = NewTaskOptions & {
  title: string;
  templateId?: string | null;
};

type TasksState = {
  tasks: Task[];
  hydrated: boolean;

  // 🔥 Hazır görevler için günlük değişim hakkı meta
  lastTemplateChangeDay: number | null;

  hydrate: () => Promise<void>;

  // Eski API – dokunmadık, ama altta yeni modelle çalışıyor
  addTask: (title: string, category?: TaskCategory, priority?: TaskPriority) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
  updateTask: (
    id: string,
    title: string,
    category?: TaskCategory,
    priority?: TaskPriority,
  ) => void;
  clearAll: () => void;
  clearCompleted: () => void;

  // 🔥 Yeni API – görev sistemi büyüdükçe bunları kullanacağız
  addCustomTask: (payload: NewTaskPayload) => void;
  addTaskFromTemplate: (templateId: string, options?: NewTaskOptions) => void;

  // 🔥 Hazır görev “günde 1 kez Değiştir” hakkı için yardımcılar
  canChangeTemplateToday: () => boolean;
  markTemplateChangedToday: () => void;

  // 🔥 Seviye / streak istatistikleri
  getStats: () => TasksStats;
};

const STORAGE_KEY = 'tasks_v1';
// 🔥 Meta için ayrı bir storage anahtarı
const META_KEY = 'tasks_meta_v1';

// Gün bazlı hesaplama için küçük yardımcı
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const toDayNumber = (ms: number) => Math.floor(ms / MS_PER_DAY);

export const useTasks = create<TasksState>((set, get) => {
  // Ortak: Yeni görev nesnesini oluşturan yardımcı fonksiyon
  const buildNewTask = (payload: NewTaskPayload): Task => {
    const now = Date.now();
    const trimmed = payload.title.trim();
    const category = payload.category ?? 'Genel';
    const priority = payload.priority ?? 'Orta';

    if (!trimmed) {
      // Güvenlik için – çağıran taraf yine de kontrol edebilir
      throw new Error('Görev başlığı boş olamaz.');
    }

    const repeatType: TaskRepeatType = payload.repeatType ?? 'none';

    const task: Task = {
      id: String(now),
      title: trimmed,
      done: false,
      ts: now,

      category,
      priority,

      description: payload.description?.trim() || undefined,
      origin: payload.origin ?? 'self',
      templateId: payload.templateId ?? null,

      dueDate: payload.dueDate ?? null,
      timeOfDay: payload.timeOfDay,

      repeatType,
      repeatDaysOfWeek: payload.repeatDaysOfWeek ?? [],
      repeatStartDate: payload.repeatStartDate ?? null,
      repeatEndDate: payload.repeatEndDate ?? null,

      // 🔥 schedule bilgisini kaydet
      schedule: payload.schedule
        ? {
            when: payload.schedule.when,
            repeat: payload.schedule.repeat,
            reminder: payload.schedule.reminder,
          }
        : undefined,

      status: 'pending',
      completedAt: undefined,

      lastEditAt: null,
      editsTodayCount: 0,

      isGroupTask: payload.isGroupTask ?? false,
      assignedByUserId: payload.assignedByUserId ?? null,
      assignedToUserIds: payload.assignedToUserIds ?? [],
      requiresPro: payload.requiresPro ?? false,
    };

    return task;
  };

  // 🔤 Hazır görev başlık/açıklama metnini aktif dile göre üret
  const getTemplateLocalizedText = (template: TaskTemplate) => {
    const baseKey = `tasks.templates.${template.id}`;
    const title = i18n.t(`${baseKey}.title`, {
      defaultValue: template.title,
    }) as string;
    const description =
      template.description != null
        ? (i18n.t(`${baseKey}.description`, {
            defaultValue: template.description,
          }) as string)
        : undefined;

    return { title, description };
  };

  return {
    tasks: [],
    hydrated: false,

    // 🔥 meta başlangıç değeri
    lastTemplateChangeDay: null,

    // AsyncStorage + safeAsync ile kayıtlı görevleri yükle
    hydrate: async () => {
      try {
        // Görevler ve meta'yı paralel oku
        const [saved, meta] = await Promise.all([
          storage.loadJson<Task[]>(STORAGE_KEY),
          storage.loadJson<TasksMeta>(META_KEY),
        ]);

        const lastTemplateChangeDay =
          meta && typeof meta.lastTemplateChangeDay === 'number'
            ? meta.lastTemplateChangeDay
            : null;

        if (saved && Array.isArray(saved)) {
          const normalized: Task[] = saved.map(raw => {
            const t: Task = {
              ...raw,
              category: raw.category ?? 'Genel',
              priority: raw.priority ?? 'Orta',
            };

            // Eski kayıtlarda origin yoksa 'legacy'
            if (!t.origin) {
              t.origin = 'legacy';
            }

            // Eski kayıtlarda repeatType yoksa 'none'
            if (!t.repeatType) {
              t.repeatType = 'none';
            }

            // Eski kayıtlarda status yoksa, done alanına göre atayalım
            if (!t.status) {
              t.status = t.done ? 'done' : 'pending';
            }

            // Bazı alanlar yoksa default ver
            if (!Array.isArray(t.repeatDaysOfWeek)) {
              t.repeatDaysOfWeek = [];
            }
            if (typeof t.repeatStartDate === 'undefined') {
              t.repeatStartDate = null;
            }
            if (typeof t.repeatEndDate === 'undefined') {
              t.repeatEndDate = null;
            }
            if (typeof t.dueDate === 'undefined') {
              t.dueDate = null;
            }
            if (typeof t.templateId === 'undefined') {
              t.templateId = null;
            }
            if (typeof t.lastEditAt === 'undefined') {
              t.lastEditAt = null;
            }
            if (typeof t.editsTodayCount === 'undefined') {
              t.editsTodayCount = 0;
            }
            if (typeof t.isGroupTask === 'undefined') {
              t.isGroupTask = false;
            }
            if (typeof t.assignedByUserId === 'undefined') {
              t.assignedByUserId = null;
            }
            if (!Array.isArray(t.assignedToUserIds)) {
              t.assignedToUserIds = [];
            }
            if (typeof t.requiresPro === 'undefined') {
              t.requiresPro = false;
            }

            // Eski kayıtlarda schedule yoksa dokunma; varsa shape'i koru
            // (UI sadece when/repeat/reminder okuyor, fazlası varsa da zarar yok)

            return t;
          });

          set({
            tasks: normalized,
            hydrated: true,
            lastTemplateChangeDay,
          });
          // normalize edilmiş hali geri yaz
          storage.saveJson(STORAGE_KEY, normalized);
        } else {
          set({
            hydrated: true,
            lastTemplateChangeDay,
          });
        }
      } catch (e) {
        console.warn('[Tasks] hydrate failed:', e);
        set({ hydrated: true });
      }
    },

    // Eski basit ekleme – self origin ile yeni build fonksiyonunu kullanıyor
    addTask: (title: string, category = 'Genel', priority = 'Orta') => {
      const trimmed = title.trim();
      if (!trimmed) return;

      const newTask = buildNewTask({
        title: trimmed,
        category,
        priority,
        origin: 'self',
      });

      const next = [newTask, ...get().tasks];
      set({ tasks: next });
      storage.saveJson(STORAGE_KEY, next);
    },

    // 🔥 Yeni: detaylı custom görev ekleme
    addCustomTask: (payload: NewTaskPayload) => {
      const trimmed = payload.title.trim();
      if (!trimmed) return;

      const newTask = buildNewTask(payload);
      const next = [newTask, ...get().tasks];
      set({ tasks: next });
      storage.saveJson(STORAGE_KEY, next);
    },

    // 🔥 Yeni: hazır görev template'inden görev üretme
    addTaskFromTemplate: (templateId: string, options: NewTaskOptions = {}) => {
      const template = TASK_TEMPLATES.find(t => t.id === templateId);
      if (!template) {
        console.warn(
          '[Tasks] addTaskFromTemplate: template not found:',
          templateId,
        );
        return;
      }

      // Aktif dile göre başlık + açıklama
      const localized = getTemplateLocalizedText(template);

      const payload: NewTaskPayload = {
        title: localized.title,
        description: options.description ?? localized.description,
        category: options.category ?? template.category,
        priority: options.priority ?? 'Orta',
        origin: options.origin ?? 'given',
        templateId: template.id,

        dueDate: options.dueDate ?? null,
        timeOfDay: options.timeOfDay,
        repeatType: options.repeatType ?? template.suggestedRepeat ?? 'none',
        repeatDaysOfWeek: options.repeatDaysOfWeek,
        repeatStartDate: options.repeatStartDate ?? null,
        repeatEndDate: options.repeatEndDate ?? null,

        isGroupTask: options.isGroupTask ?? false,
        assignedByUserId: options.assignedByUserId ?? null,
        assignedToUserIds: options.assignedToUserIds ?? [],
        requiresPro: options.requiresPro ?? false,

        schedule: options.schedule,
      };

      const newTask = buildNewTask(payload);
      const next = [newTask, ...get().tasks];
      set({ tasks: next });
      storage.saveJson(STORAGE_KEY, next);
    },

    toggleTask: (id: string) => {
      const now = Date.now();
      const next = get().tasks.map(t => {
        if (t.id !== id) return t;

        const newDone = !t.done;
        const newStatus: Task['status'] = newDone ? 'done' : 'pending';

        return {
          ...t,
          done: newDone,
          status: newStatus,
          // 🔥 Tamamlandığı anı kaydet; tekrar aktif yapılırsa completedAt'i temizle
          completedAt: newDone ? now : undefined,
        };
      });

      set({ tasks: next });
      storage.saveJson(STORAGE_KEY, next);
    },

    updateTask: (
      id: string,
      title: string,
      category?: TaskCategory,
      priority?: TaskPriority,
    ) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      const now = Date.now();
      const today = toDayNumber(now);

      const next = get().tasks.map(t => {
        if (t.id !== id) return t;

        // lastEditAt / editsTodayCount alanlarını hafifçe güncelleyelim
        const lastEditDay =
          t.lastEditAt != null ? toDayNumber(t.lastEditAt) : null;
        const sameDay = lastEditDay === today;

        return {
          ...t,
          title: trimmed,
          category: category ?? t.category ?? 'Genel',
          priority: priority ?? t.priority ?? 'Orta',
          lastEditAt: now,
          editsTodayCount: sameDay ? (t.editsTodayCount ?? 0) + 1 : 1,
        };
      });

      set({ tasks: next });
      storage.saveJson(STORAGE_KEY, next);
    },

    removeTask: (id: string) => {
      const next = get().tasks.filter(t => t.id !== id);
      set({ tasks: next });
      storage.saveJson(STORAGE_KEY, next);
    },

    clearAll: () => {
      set({ tasks: [] });
      storage.saveJson(STORAGE_KEY, []);
    },

    clearCompleted: () => {
      const next = get().tasks.filter(t => !t.done);
      set({ tasks: next });
      storage.saveJson(STORAGE_KEY, next);
    },

    // 🔥 Hazır görev “günde 1 kez Değiştir” hakkı için yardımcılar
    canChangeTemplateToday: () => {
      const state = get();
      const today = toDayNumber(Date.now());
      const last = state.lastTemplateChangeDay;

      // Hiç kullanılmamışsa serbest
      if (last === null) return true;

      // Aynı gündeyse hakkını kullanmış demektir
      return last !== today;
    },

    markTemplateChangedToday: () => {
      const today = toDayNumber(Date.now());
      set({ lastTemplateChangeDay: today });
      const meta: TasksMeta = { lastTemplateChangeDay: today };
      storage.saveJson(META_KEY, meta);
    },

    // 🔥 Seviye / streak istatistikleri (eski mantık aynen devam)
    getStats: () => {
      const tasks = get().tasks;
      const total = tasks.length;
      const completedTasks = tasks.filter(t => t.done);
      const completed = completedTasks.length;
      const active = total - completed;

      // Level: her 10 tamamlanan görev = +1 seviye, minimum seviye: 1
      const level = completed === 0 ? 1 : Math.floor(completed / 10) + 1;

      const now = Date.now();
      const todayDay = toDayNumber(now);

      // Tamamlanan görevlerin gün listesi (unique)
      const completedDays = Array.from(
        new Set(
          completedTasks.map(t => {
            const baseTs = t.completedAt ?? t.ts; // eski kayıtlarda completedAt olmayabilir
            return toDayNumber(baseTs);
          }),
        ),
      ).sort((a, b) => a - b);

      // Bugün kaç görev tamamlanmış?
      const completedToday = completedTasks.filter(t => {
        const baseTs = t.completedAt ?? t.ts;
        return toDayNumber(baseTs) === todayDay;
      }).length;

      // Current streak: bugünden geriye doğru, her gün için en az 1 görev var mı?
      let currentStreak = 0;
      if (completedDays.length > 0) {
        let dayCursor = todayDay;
        const daySet = new Set(completedDays);
        while (daySet.has(dayCursor)) {
          currentStreak += 1;
          dayCursor -= 1;
        }
      }

      // Longest streak: tüm zamanların en uzun ardışık gün serisi
      let longestStreak = 0;
      if (completedDays.length > 0) {
        let streak = 0;
        let prevDay: number | null = null;

        for (const d of completedDays) {
          if (prevDay === null || d === prevDay + 1) {
            streak += 1;
          } else {
            streak = 1;
          }
          if (streak > longestStreak) {
            longestStreak = streak;
          }
          prevDay = d;
        }
      }

      const stats: TasksStats = {
        total,
        completed,
        active,
        level,
        completedToday,
        currentStreak,
        longestStreak,
      };

      return stats;
    },
  };
});
