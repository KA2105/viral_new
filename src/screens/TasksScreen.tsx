// src/screens/TasksScreen.tsx
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native';
import {
  useTasks,
  Task,
  TaskCategory,
  TaskPriority,
  TASK_TEMPLATES,
} from '../store/useTasks';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFeed } from '../store/useFeed';
import { useUploadDraft } from '../store/useUploadDraft'; // 🔥 yeni import
import { useTranslation } from 'react-i18next';

type Props = {
  go: (screen: 'Feed' | 'Upload' | 'Tasks') => void;
};

// ❗ Viral Kırmızısı – FeedScreen'deki + butonuyla aynı
const VIRAL_RED = '#E50914';

const CATEGORY_OPTIONS: TaskCategory[] = [
  'Genel',
  'Okul',
  'İş',
  'Sağlık',
  'Aile',
  'Sosyal',
];

const PRIORITY_OPTIONS: TaskPriority[] = ['Düşük', 'Orta', 'Yüksek'];

const CATEGORY_KEY_MAP: Record<TaskCategory, string> = {
  Genel: 'general',
  Okul: 'school',
  İş: 'work',
  Sağlık: 'health',
  Aile: 'family',
  Sosyal: 'social',
};

const PRIORITY_KEY_MAP: Record<TaskPriority, string> = {
  Düşük: 'low',
  Orta: 'medium',
  Yüksek: 'high',
};

const TasksScreen: React.FC<Props> = ({ go }) => {
  const { t } = useTranslation();

  const {
    tasks,
    hydrated,
    hydrate,
    addTask,
    addCustomTask,
    addTaskFromTemplate,
    toggleTask,
    updateTask,
    removeTask,
    clearCompleted,
    getStats,
    // 🔥 hazır görevlerde günlük değişim hakkı
    canChangeTemplateToday,
    markTemplateChangedToday,
  } = useTasks();

  const removeTaskCardsByTaskTitle = useFeed(
    s => s.removeTaskCardsByTaskTitle,
  );

  // 🔥 Upload için seçilecek görev id'si
  const { setPreselectedTaskId } = useUploadDraft();

  const [input, setInput] = useState('');
  const [selectedCategory, setSelectedCategory] =
    useState<TaskCategory>('Genel');
  const [selectedPriority, setSelectedPriority] =
    useState<TaskPriority>('Orta');

  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [showAllCompleted, setShowAllCompleted] = useState(false);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingCategory, setEditingCategory] =
    useState<TaskCategory>('Genel');
  const [editingPriority, setEditingPriority] =
    useState<TaskPriority>('Orta');

  // 🔥 Görev İste / Görev Ekle sekmeleri
  const [taskMode, setTaskMode] = useState<'given' | 'self'>('self');

  // 🔥 Zaman + hatırlatıcı seçimleri (Görev Ekle modu için)
  const [selectedWhen, setSelectedWhen] = useState<
    'today' | 'tomorrow' | 'thisWeek'
  >('today');
  const [reminderOn, setReminderOn] = useState(false);

  // 🔥 Tekrar seçimi (programlı görev)
  const [repeatMode, setRepeatMode] = useState<'none' | 'daily' | 'weekly'>(
    'none',
  );

  // 🔥 Görev İste için: bir kere değiştir hakkı (UI tarafındaki flag)
  const [requestedChangeUsed, setRequestedChangeUsed] = useState(false);

  // 🔥 Görev tamamlanınca kart oluştur popup'ı için
  const [completedTaskForModal, setCompletedTaskForModal] =
    useState<Task | null>(null);

  useEffect(() => {
    if (!hydrated) {
      hydrate();
    }
  }, [hydrated, hydrate]);

  // Store’daki günlük hak bilgisiyle UI’ı senkronla
  useEffect(() => {
    if (!hydrated) return;
    try {
      const canChange = canChangeTemplateToday();
      // Eğer bugün hakkı yoksa (store “kullanıldı” diyorsa) butonu kilitle
      setRequestedChangeUsed(!canChange);
    } catch (e) {
      // sessiz geç
    }
  }, [hydrated, canChangeTemplateToday]);

  const activeTasks = tasks
    .filter(t => !t.done)
    .sort((a, b) => b.ts - a.ts);

  const completedTasks = tasks
    .filter(t => t.done)
    .sort((a, b) => b.ts - a.ts);

  // 🔥 Bugünün görevi – şimdilik en yeni aktif görev
  const todaysTask: Task | null =
    activeTasks.length > 0 ? activeTasks[0] : null;

  // 🔥 seviye / streak istatistikleri
  const stats = getStats();
  const level = stats.level;
  const completedToday = stats.completedToday;
  const currentStreak = stats.currentStreak;
  const longestStreak = stats.longestStreak;

  // 🔥 Görev İste için: aktif verilen (origin: given) görev
  const requestedTasks = activeTasks.filter(t => t.origin === 'given');
  const currentRequestedTask = requestedTasks[0] ?? null;

  // Rastgele template seç
  const pickRandomTemplateId = (excludeId?: string | null) => {
    if (TASK_TEMPLATES.length === 0) return null;
    const pool =
      excludeId != null
        ? TASK_TEMPLATES.filter(t => t.id !== excludeId)
        : TASK_TEMPLATES;

    if (pool.length === 0) {
      return TASK_TEMPLATES[0].id;
    }
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx].id;
  };

  // Havuzdan rastgele görev üret
  const requestRandomTask = (excludeTemplateId?: string | null) => {
    const templateId = pickRandomTemplateId(excludeTemplateId);
    if (!templateId) return;

    addTaskFromTemplate(templateId, {
      origin: 'given',
      // İleride buraya ekstra opsiyonlar (zaman, repeat vb.) ekleyebiliriz
    });
  };

  const handleRequestRandomTask = () => {
    if (currentRequestedTask) {
      // Zaten bugünkü görev verilmiş; buton pasif
      return;
    }
    requestRandomTask(null);

    // Yeni görev isteyince, o gün için değiştir hakkı store’a göre ayarlansın
    try {
      const canChange = canChangeTemplateToday();
      setRequestedChangeUsed(!canChange);
    } catch {
      setRequestedChangeUsed(false);
    }
  };

  const handleChangeRequestedTask = () => {
    if (!currentRequestedTask) return;

    // Store’a göre bugünlük değiştir hakkı var mı?
    if (!canChangeTemplateToday()) {
      Alert.alert(
        t('tasks.requestAlerts.noMoreChangesTitle'),
        t('tasks.requestAlerts.noMoreChangesBody'),
      );
      setRequestedChangeUsed(true);
      return;
    }

    // Ekstra güvenlik: yerel flag de “kullanıldı” ise
    if (requestedChangeUsed) {
      Alert.alert(
        t('tasks.requestAlerts.noMoreChangesTitle'),
        t('tasks.requestAlerts.alreadyChangedBody'),
      );
      return;
    }

    const previousTemplateId = currentRequestedTask.templateId ?? null;
    // Eski görevi sil
    removeTask(currentRequestedTask.id);
    // Farklı bir görev getir (mümkünse aynı template'i hariç tut)
    requestRandomTask(previousTemplateId);

    // değiştir hakkı kullanıldı – hem UI hem store
    setRequestedChangeUsed(true);
    markTemplateChangedToday();
  };

  const handleCompleteRequestedTask = () => {
    if (!currentRequestedTask) return;

    // Görevi tamamla
    toggleTask(currentRequestedTask.id);

    // Güncel istatistikleri oku
    const afterStats = getStats();
    const { level, completedToday, currentStreak } = afterStats;

    // 🔥 Tek adımda kart akışına geçebilmek için iki seçenekli popup
    Alert.alert(
      t('tasks.completeRequested.alertTitle'),
      t('tasks.completeRequested.alertBody', {
        level,
        completedToday,
        streak: currentStreak,
      }),
      [
        {
          text: t('tasks.completeRequested.ok'),
          style: 'cancel',
        },
        {
          text: t('tasks.completeRequested.createCard'),
          onPress: () => {
            // Upload ekranında bu görevi önceden seçili hale getir
            setPreselectedTaskId(currentRequestedTask.id);
            go('Upload');
          },
        },
      ],
    );
  };

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // 🔥 schedule + origin ile ekle
    addCustomTask({
      title: trimmed,
      category: selectedCategory,
      priority: selectedPriority,
      origin: 'self',
      schedule: {
        when: selectedWhen,
        repeat: repeatMode,
        reminder: reminderOn,
      },
    });

    setInput('');
  };

  // 🔥 Aktif görev checkbox'ına basılınca – ilk kez tamamlanıyorsa popup aç
  const handleToggleTaskWithPopup = (task: Task) => {
    const wasDone = task.done;
    toggleTask(task.id);
    if (!wasDone) {
      setCompletedTaskForModal(task);
    }
  };

  // 🔥 Hazır görev ekleme (eski: liste modu – artık Görev İste dışı/debug amaçlı)
  const handleAddFromTemplate = (templateId: string) => {
    addTaskFromTemplate(templateId, {
      origin: 'given',
    });
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setEditingText(task.title);
    setEditingCategory(task.category ?? 'Genel');
    setEditingPriority(task.priority ?? 'Orta');
  };

  const saveEdit = () => {
    if (!editingTask) return;
    const trimmed = editingText.trim();
    if (!trimmed) return;
    updateTask(
      editingTask.id,
      trimmed,
      editingCategory,
      editingPriority,
    );
    setEditingTask(null);
    setEditingText('');
  };

  const handleClearCompleted = () => {
    if (completedTasks.length === 0) return;

    Alert.alert(
      t('tasks.alerts.clearCompletedTitle'),
      t('tasks.alerts.clearCompletedBody'),
      [
        { text: t('tasks.alerts.clearCancel'), style: 'cancel' },
        {
          text: t('tasks.alerts.clearConfirm'),
          style: 'destructive',
          onPress: () => clearCompleted(),
        },
      ],
    );
  };

  // Tek tek tamamlanan görev silerken Akış kartları için seçenek sun
  const handleDeleteCompletedTask = (task: Task) => {
    Alert.alert(
      t('tasks.alerts.deleteTaskTitle'),
      t('tasks.alerts.deleteTaskBody'),
      [
        {
          text: t('tasks.alerts.deleteCancel'),
          style: 'cancel',
        },
        {
          text: t('tasks.alerts.deleteOnlyTask'),
          onPress: () => {
            removeTask(task.id);
          },
        },
        {
          text: t('tasks.alerts.deleteTaskAndCards'),
          style: 'destructive',
          onPress: () => {
            removeTask(task.id);
            removeTaskCardsByTaskTitle(task.title);
          },
        },
      ],
    );
  };

  const completedVisibleTasks: Task[] =
    completedCollapsed
      ? []
      : showAllCompleted
      ? completedTasks
      : completedTasks.slice(0, 3);

  const renderMetaLine = (task: Task, type: 'active' | 'done') => {
    const cat = task.category ?? 'Genel';
    const pr = task.priority ?? 'Orta';

    const catKey = CATEGORY_KEY_MAP[cat] ?? 'general';
    const prKey = PRIORITY_KEY_MAP[pr] ?? 'medium';

    const catLabel = t(`tasks.categories.${catKey}`);
    const prLabel = t(`tasks.priorities.${prKey}`);

    const dateLabelKey =
      type === 'active'
        ? 'tasks.meta.createdAt'
        : 'tasks.meta.completedAt';
    const dateLabel = t(dateLabelKey);

    // 🔥 Tamamlanan görevlerde completedAt varsa onu kullan
    const dateSource =
      type === 'active'
        ? task.ts
        : task.completedAt != null
        ? task.completedAt
        : task.ts;

    const datePart = `${dateLabel}: ${new Date(
      dateSource,
    ).toLocaleString()}`;

    const originLabel =
      task.origin === 'given'
        ? t('tasks.meta.originGiven')
        : t('tasks.meta.originSelf');

    let whenPart: string | null = null;
    const when = task.schedule?.when;
    if (when) {
      const whenLabel = t(`tasks.scheduleOptions.${when}`);
      whenPart = t('tasks.meta.timePrefix', { when: whenLabel });
    }

    let repeatPart: string | null = null;
    const repeat = task.schedule?.repeat;
    if (repeat && repeat !== 'none') {
      const repeatLabel = t(`tasks.repeatOptions.${repeat}`);
      repeatPart = t('tasks.meta.repeatPrefix', { repeat: repeatLabel });
    }

    const parts: string[] = [
      catLabel,
      t('tasks.meta.priorityPrefix', { priority: prLabel }),
    ];

    if (whenPart) {
      parts.push(whenPart);
    }
    if (repeatPart) {
      parts.push(repeatPart);
    }

    parts.push(originLabel);
    parts.push(datePart);

    return parts.join(' · ');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('tasks.screenTitle')}</Text>

        {/* Küçük istatistik satırı */}
        <Text style={styles.statsText}>
          {t('tasks.statsLine', {
            active: activeTasks.length,
            completed: completedTasks.length,
          })}
        </Text>

        {/* 🔥 Bugünün görevi kartı (en yeni aktif görev) */}
        {todaysTask && (
          <View style={styles.todaysTaskCard}>
            <View style={styles.todaysTaskHeaderRow}>
              <Text style={styles.todaysTaskLabel}>
                {t('tasks.todayCard.label')}
              </Text>
              <Text style={styles.todaysTaskChip}>
                {
                  t(
                    `tasks.categories.${
                      CATEGORY_KEY_MAP[
                        (todaysTask.category ?? 'Genel') as TaskCategory
                      ]
                    }`,
                  ) as string
                }
              </Text>
            </View>
            <Text
              style={styles.todaysTaskTitle}
              numberOfLines={2}
            >
              {todaysTask.title}
            </Text>
            <Text style={styles.todaysTaskMeta}>
              {renderMetaLine(todaysTask, 'active')}
            </Text>
            <View style={styles.todaysTaskActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.todaysDoneBtn,
                  pressed && styles.todaysDoneBtnPressed,
                ]}
                onPress={() => handleToggleTaskWithPopup(todaysTask)}
              >
                <Text style={styles.todaysDoneBtnText}>
                  {t('tasks.todayCard.doneButton')}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* 🔥 Seviye / seri kartı */}
        <View style={styles.levelCard}>
          <View style={styles.levelLeft}>
            <Text style={styles.levelLabel}>
              {t('tasks.levelCard.label')}
            </Text>
            <Text style={styles.levelValue}>{level}</Text>
          </View>
          <View style={styles.levelRight}>
            <Text style={styles.levelLine}>
              {t('tasks.levelCard.streak', {
                count: currentStreak,
              })}
            </Text>
            <Text style={styles.levelLine}>
              {t('tasks.levelCard.completedToday', {
                count: completedToday,
              })}
            </Text>
            <Text style={styles.levelLine}>
              {t('tasks.levelCard.longestStreak', {
                count: longestStreak,
              })}
            </Text>
          </View>
        </View>

        {/* 🔥 Görev İste / Görev Ekle sekmeleri */}
        <View style={styles.modeRow}>
          <Pressable
            style={({ pressed }) => [
              styles.modeBtn,
              styles.modeBtnGiven,
              taskMode === 'given' && styles.modeBtnGivenActive,
              pressed && styles.modeBtnPressed,
            ]}
            onPress={() => setTaskMode('given')}
          >
            <Text
              style={[
                styles.modeBtnText,
                styles.modeBtnTextGiven,
                taskMode === 'given' && styles.modeBtnTextGivenActive,
              ]}
            >
              {t('tasks.modes.givenTitle')}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.modeBtn,
              styles.modeBtnSelf,
              taskMode === 'self' && styles.modeBtnSelfActive,
              pressed && styles.modeBtnPressed,
            ]}
            onPress={() => setTaskMode('self')}
          >
            <Text
              style={[
                styles.modeBtnText,
                styles.modeBtnTextSelf,
                taskMode === 'self' && styles.modeBtnTextSelfActive,
              ]}
            >
              {t('tasks.modes.selfTitle')}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.modeDescription}>
          {taskMode === 'given'
            ? t('tasks.modes.givenDescription')
            : t('tasks.modes.selfDescription')}
        </Text>

        {/* 🔵 GÖREV EKLEME ALANI – manuel (kendine görev) */}
        {taskMode === 'self' && (
          <>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={t('tasks.self.inputPlaceholder')}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={handleAdd}
                returnKeyType="done"
              />
            </View>

            {/* Kategori & Öncelik seçiciler */}
            <View style={styles.chipRow}>
              {CATEGORY_OPTIONS.map(cat => {
                const selected = cat === selectedCategory;
                const catKey = CATEGORY_KEY_MAP[cat];
                const label = t(`tasks.categories.${catKey}`);
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setSelectedCategory(cat)}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && styles.chipSelected,
                      pressed && styles.chipPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.chipRow}>
              {PRIORITY_OPTIONS.map(p => {
                const selected = p === selectedPriority;
                const prKey = PRIORITY_KEY_MAP[p];
                const label = t(`tasks.priorities.${prKey}`);
                return (
                  <Pressable
                    key={p}
                    onPress={() => setSelectedPriority(p)}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && styles.priorityChipSelected(p),
                      pressed && styles.chipPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* 🔥 Zaman seçimi */}
            <Text style={styles.scheduleLabel}>
              {t('tasks.self.scheduleQuestion')}
            </Text>
            <View style={styles.chipRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  selectedWhen === 'today' && styles.chipSelected,
                  pressed && styles.chipPressed,
                ]}
                onPress={() => setSelectedWhen('today')}
              >
                <Text
                  style={[
                    styles.chipText,
                    selectedWhen === 'today' && styles.chipTextSelected,
                  ]}
                >
                  {t('tasks.scheduleOptions.today')}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  selectedWhen === 'tomorrow' && styles.chipSelected,
                  pressed && styles.chipPressed,
                ]}
                onPress={() => setSelectedWhen('tomorrow')}
              >
                <Text
                  style={[
                    styles.chipText,
                    selectedWhen === 'tomorrow' &&
                      styles.chipTextSelected,
                  ]}
                >
                  {t('tasks.scheduleOptions.tomorrow')}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  selectedWhen === 'thisWeek' && styles.chipSelected,
                  pressed && styles.chipPressed,
                ]}
                onPress={() => setSelectedWhen('thisWeek')}
              >
                <Text
                  style={[
                    styles.chipText,
                    selectedWhen === 'thisWeek' &&
                      styles.chipTextSelected,
                  ]}
                >
                  {t('tasks.scheduleOptions.thisWeek')}
                </Text>
              </Pressable>
            </View>

            {/* 🔥 Tekrar seçimi */}
            <Text style={styles.scheduleLabel}>
              {t('tasks.self.repeatQuestion')}
            </Text>
            <View style={styles.chipRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  repeatMode === 'none' && styles.chipSelected,
                  pressed && styles.chipPressed,
                ]}
                onPress={() => setRepeatMode('none')}
              >
                <Text
                  style={[
                    styles.chipText,
                    repeatMode === 'none' && styles.chipTextSelected,
                  ]}
                >
                  {t('tasks.repeatOptions.none')}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  repeatMode === 'daily' && styles.chipSelected,
                  pressed && styles.chipPressed,
                ]}
                onPress={() => setRepeatMode('daily')}
              >
                <Text
                  style={[
                    styles.chipText,
                    repeatMode === 'daily' && styles.chipTextSelected,
                  ]}
                >
                  {t('tasks.repeatOptions.daily')}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  repeatMode === 'weekly' && styles.chipSelected,
                  pressed && styles.chipPressed,
                ]}
                onPress={() => setRepeatMode('weekly')}
              >
                <Text
                  style={[
                    styles.chipText,
                    repeatMode === 'weekly' && styles.chipTextSelected,
                  ]}
                >
                  {t('tasks.repeatOptions.weekly')}
                </Text>
              </Pressable>
            </View>

            {/* 🔥 Hatırlatıcı */}
            <View style={styles.reminderRow}>
              <Text style={styles.reminderLabel}>
                {t('tasks.self.reminderLabel')}
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.reminderPill,
                  reminderOn && styles.reminderPillOn,
                  pressed && styles.reminderPillPressed,
                ]}
                onPress={() => setReminderOn(prev => !prev)}
              >
                <Text
                  style={[
                    styles.reminderPillText,
                    reminderOn && styles.reminderPillTextOn,
                  ]}
                >
                  {reminderOn
                    ? t('tasks.self.reminderOn')
                    : t('tasks.self.reminderOff')}
                </Text>
              </Pressable>
            </View>

            <View style={styles.actionRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.addBtn,
                  pressed && styles.addBtnPressed,
                ]}
                onPress={handleAdd}
              >
                <Text style={styles.addBtnText}>
                  {t('tasks.self.addButton')}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.backBtn,
                  pressed && styles.backBtnPressed,
                ]}
                onPress={() => go('Feed')}
              >
                <Text style={styles.backBtnText}>
                  {t('tasks.self.backToFeedButton')}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {/* 🔴 GÖREV İSTE ALANI – sürpriz görev + Pro kartı */}
        {taskMode === 'given' && (
          <>
            {/* Sürpriz görev alanı */}
            <View style={styles.requestArea}>
              <Text style={styles.requestTitleText}>
                {t('tasks.request.areaTitle')}
              </Text>
              <Text style={styles.requestSubtitleText}>
                {t('tasks.request.areaSubtitle')}
              </Text>

              <Pressable
                style={({ pressed }) => [
                  styles.requestButton,
                  currentRequestedTask && styles.requestButtonDisabled,
                  pressed &&
                    !currentRequestedTask &&
                    styles.requestButtonPressed,
                ]}
                onPress={handleRequestRandomTask}
              >
                <Text style={styles.requestButtonText}>
                  {currentRequestedTask
                    ? t('tasks.request.buttonHasTask')
                    : t('tasks.request.buttonIdle')}
                </Text>
              </Pressable>
            </View>

            {/* Eğer bugün atanmış görev varsa, tek görev kartı */}
            {currentRequestedTask && (
              <View style={styles.requestCard}>
                <Text style={styles.requestCardTitle}>
                  {t('tasks.request.cardTitlePrefix')}
                  {currentRequestedTask.title}
                </Text>
                {currentRequestedTask.description ? (
                  <Text style={styles.requestCardDescription}>
                    {currentRequestedTask.description}
                  </Text>
                ) : null}
                <Text style={styles.requestCardMeta}>
                  {renderMetaLine(currentRequestedTask, 'active')}
                </Text>

                <View style={styles.requestActionsRow}>
                  <TouchableOpacity
                    style={styles.requestDoBtn}
                    onPress={handleCompleteRequestedTask}
                  >
                    <Text style={styles.requestDoBtnText}>
                      {t('tasks.request.doButton')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.requestChangeBtn,
                      requestedChangeUsed &&
                        styles.requestChangeBtnDisabled,
                    ]}
                    disabled={requestedChangeUsed}
                    onPress={handleChangeRequestedTask}
                  >
                    <Text
                      style={[
                        styles.requestChangeBtnText,
                        requestedChangeUsed &&
                          styles.requestChangeBtnTextDisabled,
                      ]}
                    >
                      {requestedChangeUsed
                        ? t('tasks.request.changeUsedLabel')
                        : t('tasks.request.changeButton')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* 🔒 Pro bilgilendirme kartı */}
            <View style={styles.proCard}>
              <View style={styles.proCardLeft}>
                <Text style={styles.proIcon}>🔒</Text>
              </View>
              <View style={styles.proCardRight}>
                <Text style={styles.proTitle}>
                  {t('tasks.pro.title')}
                </Text>
                <Text style={styles.proText}>
                  {t('tasks.pro.body')}
                </Text>
                <Pressable
                  style={styles.proButton}
                  onPress={() =>
                    Alert.alert(
                      t('tasks.pro.alertTitle'),
                      t('tasks.pro.alertBody'),
                    )
                  }
                >
                  <Text style={styles.proButtonText}>
                    {t('tasks.pro.button')}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Eski hazır görev listesi – şimdilik gizli, referans dursun */}
            {/*
            <Text style={[styles.helperText, { marginTop: 6 }]}>
              Aşağıdaki hazır görevlerden birini seçebilirsin. İstersen
              daha sonra düzenleyerek kendine göre uyarlarsın.
            </Text>

            <View style={styles.templateList}>
              {TASK_TEMPLATES.map(tpl => (
                <Pressable
                  key={tpl.id}
                  style={({ pressed }) => [
                    styles.templateCard,
                    pressed && styles.templateCardPressed,
                  ]}
                  onPress={() => handleAddFromTemplate(tpl.id)}
                >
                  <Text style={styles.templateTitle}>{tpl.title}</Text>
                  {tpl.description ? (
                    <Text style={styles.templateDescription}>
                      {tpl.description}
                    </Text>
                  ) : null}
                  <View style={styles.templateMetaRow}>
                    <Text style={styles.templateCategoryTag}>
                      {tpl.category}
                    </Text>
                    {tpl.suggestedRepeat && (
                      <Text style={styles.templateRepeatTag}>
                        {tpl.suggestedRepeat === 'daily'
                          ? 'Her gün'
                          : tpl.suggestedRepeat === 'weekly'
                          ? 'Haftalık'
                          : 'Tek seferlik'}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>

            <View style={[styles.actionRow, { marginTop: 4 }]}>
              <View style={{ flex: 1 }} />
              <Pressable
                style={({ pressed }) => [
                  styles.backBtn,
                  pressed && styles.backBtnPressed,
                ]}
                onPress={() => go('Feed')}
              >
                <Text style={styles.backBtnText}>← Akış</Text>
              </Pressable>
            </View>
            */}
          </>
        )}

        {/* AKTİF GÖREVLER */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('tasks.sections.activeTitle')}
          </Text>
          {activeTasks.length === 0 ? (
            <Text style={styles.helperText}>
              {t('tasks.sections.activeEmpty')}
            </Text>
          ) : (
            activeTasks.map(task => (
              <View key={task.id} style={styles.taskCard}>
                <Pressable
                  style={styles.checkbox}
                  onPress={() => handleToggleTaskWithPopup(task)}
                >
                  <View
                    style={[
                      styles.checkboxInner,
                      task.done && styles.checkboxInnerDone,
                    ]}
                  />
                </Pressable>

                <View style={styles.taskContent}>
                  <Text style={styles.taskTitle} numberOfLines={1}>
                    {task.title}
                  </Text>
                  <Text style={styles.taskMeta}>
                    {renderMetaLine(task, 'active')}
                  </Text>
                </View>

                <View style={styles.taskActions}>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => openEdit(task)}
                  >
                    <Text style={styles.editBtnText}>
                      {t('tasks.buttons.edit')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => removeTask(task.id)}
                  >
                    <Text style={styles.deleteBtnText}>
                      {t('tasks.buttons.delete')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* TAMAMLANAN GÖREVLER */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              {t('tasks.sections.completedTitle')}{' '}
              {completedTasks.length > 0
                ? `(${completedTasks.length})`
                : ''}
            </Text>

            {completedTasks.length > 0 && (
              <View style={styles.sectionHeaderRight}>
                <Pressable
                  onPress={() => setCompletedCollapsed(prev => !prev)}
                  style={({ pressed }) => [
                    styles.collapseBtn,
                    pressed && styles.collapseBtnPressed,
                  ]}
                >
                  <Text style={styles.collapseBtnText}>
                    {completedCollapsed
                      ? t('tasks.sections.completedToggleShow')
                      : t('tasks.sections.completedToggleHide')}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleClearCompleted}
                  style={({ pressed }) => [
                    styles.clearBtn,
                    pressed && styles.clearBtnPressed,
                  ]}
                >
                  <Text style={styles.clearBtnText}>
                    {t('tasks.sections.completedClear')}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {completedTasks.length === 0 ? (
            <Text style={styles.helperText}>
              {t('tasks.sections.completedEmpty')}
            </Text>
          ) : completedCollapsed ? null : (
            <>
              {completedVisibleTasks.map(task => (
                <View key={task.id} style={styles.taskCardCompleted}>
                  {/* Üst satır: yeşil nokta + başlık + meta */}
                  <View style={styles.completedHeaderRow}>
                    <View style={styles.completedDot} />
                    <View style={styles.taskContent}>
                      <Text
                        style={styles.taskTitleCompleted}
                        numberOfLines={1}
                      >
                        {task.title}
                      </Text>
                      <Text style={styles.taskMeta}>
                        {renderMetaLine(task, 'done')}
                      </Text>
                    </View>
                  </View>

                  {/* Alt satır: butonlar */}
                  <View
                    style={[
                      styles.taskActions,
                      styles.taskActionsCompleted,
                    ]}
                  >
                    {/* Tekrar aktif yap */}
                    <TouchableOpacity
                      style={styles.reactivateBtn}
                      onPress={() => toggleTask(task.id)}
                    >
                      <Text style={styles.reactivateBtnText}>
                        {t('tasks.sections.completedReactivate')}
                      </Text>
                    </TouchableOpacity>

                    {/* Kart oluştur → UploadScreen + preselect */}
                    <TouchableOpacity
                      style={styles.createCardBtn}
                      onPress={() => {
                        setPreselectedTaskId(task.id);
                        go('Upload');
                      }}
                    >
                      <Text style={styles.createCardBtnText}>
                        {t('tasks.sections.completedCreateCard')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.editBtn}
                      onPress={() => openEdit(task)}
                    >
                      <Text style={styles.editBtnText}>
                        {t('tasks.buttons.edit')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() =>
                        handleDeleteCompletedTask(task)
                      }
                    >
                      <Text style={styles.deleteBtnText}>
                        {t('tasks.buttons.delete')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              {completedTasks.length > 3 &&
                !showAllCompleted &&
                !completedCollapsed && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.moreBtn,
                      pressed && styles.moreBtnPressed,
                    ]}
                    onPress={() => setShowAllCompleted(true)}
                  >
                    <Text style={styles.moreBtnText}>
                      {t('tasks.sections.completedShowMore')}
                    </Text>
                  </Pressable>
                )}

              {completedTasks.length > 3 &&
                showAllCompleted &&
                !completedCollapsed && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.moreBtn,
                      pressed && styles.moreBtnPressed,
                    ]}
                    onPress={() => setShowAllCompleted(false)}
                  >
                    <Text style={styles.moreBtnText}>
                      {t('tasks.sections.completedShowLess')}
                    </Text>
                  </Pressable>
                )}
            </>
          )}
        </View>
      </ScrollView>

      {/* DÜZENLEME MODALI */}
      <Modal
        visible={!!editingTask}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingTask(null)}
      >
        <View style={styles.editBackdrop}>
          <View style={styles.editModal}>
            <Text style={styles.editTitle}>
              {t('tasks.edit.title')}
            </Text>
            <TextInput
              style={styles.editInput}
              value={editingText}
              onChangeText={setEditingText}
              placeholder={t('tasks.edit.placeholder')}
            />

            {/* Düzenle modalinde kategori / öncelik */}
            <View style={[styles.chipRow, { marginTop: 10 }]}>
              {CATEGORY_OPTIONS.map(cat => {
                const selected = cat === editingCategory;
                const catKey = CATEGORY_KEY_MAP[cat];
                const label = t(`tasks.categories.${catKey}`);
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setEditingCategory(cat)}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && styles.chipSelected,
                      pressed && styles.chipPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.chipRow}>
              {PRIORITY_OPTIONS.map(p => {
                const selected = p === editingPriority;
                const prKey = PRIORITY_KEY_MAP[p];
                const label = t(`tasks.priorities.${prKey}`);
                return (
                  <Pressable
                    key={p}
                    onPress={() => setEditingPriority(p)}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && styles.priorityChipSelected(p),
                      pressed && styles.chipPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.editButtonsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.editCancelBtn,
                  pressed && styles.editCancelBtnPressed,
                ]}
                onPress={() => setEditingTask(null)}
              >
                <Text style={styles.editCancelText}>
                  {t('tasks.edit.cancel')}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.editSaveBtn,
                  pressed && styles.editSaveBtnPressed,
                ]}
                onPress={saveEdit}
              >
                <Text style={styles.editSaveText}>
                  {t('tasks.edit.save')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 🔥 Görev tamamlandı → Kart oluştur modali */}
      <Modal
        visible={!!completedTaskForModal}
        transparent
        animationType="fade"
        onRequestClose={() => setCompletedTaskForModal(null)}
      >
        <View style={styles.completeBackdrop}>
          <View style={styles.completeModal}>
            <Text style={styles.completeTitle}>
              {t('tasks.completeModal.title')}
            </Text>
            {completedTaskForModal && (
              <Text
                style={styles.completeTaskTitle}
                numberOfLines={2}
              >
                {completedTaskForModal.title}
              </Text>
            )}
            <Text style={styles.completeText}>
              {t('tasks.completeModal.text')}
            </Text>
            <View style={styles.completeButtonsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.completeLaterBtn,
                  pressed && styles.completeLaterBtnPressed,
                ]}
                onPress={() => setCompletedTaskForModal(null)}
              >
                <Text style={styles.completeLaterText}>
                  {t('tasks.completeModal.later')}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.completeCardBtn,
                  pressed && styles.completeCardBtnPressed,
                ]}
                onPress={() => {
                  if (!completedTaskForModal) return;
                  setPreselectedTaskId(completedTaskForModal.id);
                  setCompletedTaskForModal(null);
                  go('Upload');
                }}
              >
                <Text style={styles.completeCardText}>
                  {t('tasks.completeModal.createCard')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

export default TasksScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 4,
    color: '#111',
  },
  statsText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 6,
  },

  // 🔥 Bugünün görevi kartı
  todaysTaskCard: {
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#ffe0e6',
    marginBottom: 10,
  },
  todaysTaskHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  todaysTaskLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#c62828',
  },
  todaysTaskChip: {
    fontSize: 11,
    fontWeight: '600',
    color: '#00695c',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#e0f2f1',
  },
  todaysTaskTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    marginBottom: 4,
  },
  todaysTaskMeta: {
    fontSize: 11,
    color: '#777',
    marginBottom: 6,
  },
  todaysTaskActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  todaysDoneBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: VIRAL_RED,
  },
  todaysDoneBtnPressed: {
    opacity: 0.85,
  },
  todaysDoneBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },

  // 🔥 Seviye / seri kartı
  levelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ffd4dd',
    marginBottom: 10,
  },
  levelLeft: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: VIRAL_RED,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  levelLabel: {
    fontSize: 11,
    color: '#ffeaea',
    fontWeight: '600',
  },
  levelValue: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '800',
    marginTop: 2,
  },
  levelRight: {
    flex: 1,
  },
  levelLine: {
    fontSize: 12,
    color: '#444',
    marginBottom: 2,
  },
  levelHighlight: {
    fontWeight: '700',
    color: '#c62828',
  },

  // 🔥 Görev İste / Görev Ekle sekme stilleri (renkli)
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  modeBtn: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Görev İste (turkuaz tonları)
  modeBtnGiven: {
    borderColor: '#26a69a',
    backgroundColor: '#e0f2f1',
  },
  modeBtnGivenActive: {
    backgroundColor: '#26a69a',
  },
  // Görev Ekle (pembe/kırmızı tonları)
  modeBtnSelf: {
    borderColor: '#ff8a80',
    backgroundColor: '#ffebee',
  },
  modeBtnSelfActive: {
    backgroundColor: VIRAL_RED,
  },
  modeBtnPressed: {
    opacity: 0.85,
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modeBtnTextGiven: {
    color: '#00695c',
  },
  modeBtnTextGivenActive: {
    color: '#fff',
  },
  modeBtnTextSelf: {
    color: '#c62828',
  },
  modeBtnTextSelfActive: {
    color: '#fff',
  },
  modeDescription: {
    fontSize: 12,
    color: '#666',
    marginBottom: 10,
  },

  inputRow: {
    marginBottom: 10,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    fontSize: 14,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  chipSelected: {
    borderColor: '#111',
    backgroundColor: '#111',
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipText: {
    fontSize: 11,
    color: '#444',
  },
  chipTextSelected: {
    color: '#fff',
    fontWeight: '700',
  },
  priorityChipSelected: (p: TaskPriority) => ({
    borderColor:
      p === 'Yüksek' ? '#c62828' : p === 'Düşük' ? '#2e7d32' : '#111',
    backgroundColor:
      p === 'Yüksek' ? '#ffcdd2' : p === 'Düşük' ? '#c8e6c9' : '#111',
  }),

  // 🔥 Zaman / hatırlatıcı stilleri
  scheduleLabel: {
    fontSize: 12,
    color: '#555',
    marginBottom: 4,
    marginTop: 2,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  reminderLabel: {
    fontSize: 12,
    color: '#555',
  },
  reminderPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  reminderPillOn: {
    borderColor: '#2e7d32',
    backgroundColor: '#e8f5e9',
  },
  reminderPillPressed: {
    opacity: 0.8,
  },
  reminderPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
  },
  reminderPillTextOn: {
    color: '#2e7d32',
  },

  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  // 🔥 Viral Kırmızısı (FeedScreen ile aynı olacak)
  addBtn: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: VIRAL_RED,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  addBtnPressed: { opacity: 0.8 },
  addBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  backBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#eee',
    justifyContent: 'center',
  },
  backBtnPressed: { backgroundColor: '#e0e0e0' },
  backBtnText: {
    fontWeight: '600',
    color: '#333',
  },

  section: {
    marginTop: 4,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
    color: '#222',
  },
  helperText: {
    fontSize: 13,
    color: '#777',
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  collapseBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#eee',
  },
  collapseBtnPressed: { backgroundColor: '#e0e0e0' },
  collapseBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#444',
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#ffe5e5',
  },
  clearBtnPressed: { backgroundColor: '#ffcccc' },
  clearBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b71c1c',
  },

  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#fff',
    marginBottom: 6,
  },
  taskCardCompleted: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f5fff5',
    marginBottom: 6,
  },
  completedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxInner: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: 'transparent',
  },
  checkboxInnerDone: {
    backgroundColor: '#4caf50',
  },
  completedDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4caf50',
    marginRight: 10,
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222',
  },
  taskTitleCompleted: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2e7d32',
  },
  taskMeta: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  taskActions: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 8,
  },
  taskActionsCompleted: {
    marginTop: 6,
    marginLeft: 0,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  editBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#eee',
  },
  editBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
  },
  deleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#f44336',
  },
  deleteBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  reactivateBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#e0f2f1',
  },
  reactivateBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#00695c',
  },

  // ✅ Kart oluştur butonu (mint tonları)
  createCardBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#e0f7fa',
  },
  createCardBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#006064',
  },

  moreBtn: {
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#eee',
  },
  moreBtnPressed: {
    backgroundColor: '#e0e0e0',
  },
  moreBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#444',
  },

  // Düzenleme modali
  editBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editModal: {
    width: '85%',
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 16,
  },
  editTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  editInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    fontSize: 14,
  },
  editButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 14,
  },
  editCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eee',
  },
  editCancelBtnPressed: {
    backgroundColor: '#e0e0e0',
  },
  editCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
  },
  editSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#111',
  },
  editSaveBtnPressed: {
    opacity: 0.8,
  },
  editSaveText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },

  // 🔥 Hazır görev kartları (eski liste – şimdilik kullanılmıyor, yukarıda yorumlu)
  templateList: {
    marginTop: 8,
    marginBottom: 12,
    gap: 8,
  },
  templateCard: {
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#eee',
  },
  templateCardPressed: {
    backgroundColor: '#f5f5f5',
  },
  templateTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
    marginBottom: 2,
  },
  templateDescription: {
    fontSize: 12,
    color: '#555',
    marginBottom: 6,
  },
  templateMetaRow: {
    flexDirection: 'row',
    gap: 6,
  },
  // lacivert yerine mor / lila tonları
  templateCategoryTag: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4a148c',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f3e5f5',
  },
  templateRepeatTag: {
    fontSize: 11,
    fontWeight: '600',
    color: '#00695c',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#e0f2f1',
  },

  // 🔒 Pro bilgilendirme kartı
  proCard: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#fff7f8',
    borderWidth: 1,
    borderColor: '#ffcdd2',
    marginBottom: 6,
  },
  proCardLeft: {
    marginRight: 8,
    justifyContent: 'center',
  },
  proIcon: {
    fontSize: 22,
  },
  proCardRight: {
    flex: 1,
  },
  proTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#b71c1c',
    marginBottom: 2,
  },
  proText: {
    fontSize: 12,
    color: '#555',
    marginBottom: 6,
  },
  proButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: VIRAL_RED,
  },
  proButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },

  // 🔥 Görev İste – sürpriz görev alanı
  requestArea: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0f2f1',
    marginBottom: 8,
  },
  requestTitleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#004d40',
    marginBottom: 2,
  },
  requestSubtitleText: {
    fontSize: 12,
    color: '#555',
    marginBottom: 8,
  },
  requestButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: VIRAL_RED,
  },
  requestButtonPressed: {
    opacity: 0.85,
  },
  requestButtonDisabled: {
    backgroundColor: '#ffcdd2',
  },
  requestButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  requestCard: {
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ffe0e0',
  },
  requestCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#b71c1c',
    marginBottom: 2,
  },
  requestCardDescription: {
    fontSize: 12,
    color: '#555',
    marginBottom: 4,
  },
  requestCardMeta: {
    fontSize: 11,
    color: '#777',
    marginBottom: 8,
  },
  requestActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  requestDoBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#e8f5e9',
  },
  requestDoBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2e7d32',
  },
  requestChangeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fff3e0',
  },
  requestChangeBtnDisabled: {
    backgroundColor: '#eeeeee',
  },
  requestChangeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef6c00',
  },
  requestChangeBtnTextDisabled: {
    color: '#9e9e9e',
  },

  // 🔥 Görev tamamlandı → Kart oluştur modali stilleri
  completeBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeModal: {
    width: '85%',
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 16,
  },
  completeTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  completeTaskTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
    marginBottom: 6,
  },
  completeText: {
    fontSize: 12,
    color: '#555',
    marginBottom: 12,
  },
  completeButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  completeLaterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eee',
  },
  completeLaterBtnPressed: {
    backgroundColor: '#e0e0e0',
  },
  completeLaterText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
  },
  completeCardBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: VIRAL_RED,
  },
  completeCardBtnPressed: {
    opacity: 0.85,
  },
  completeCardText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
