export type ReviewEndpoint = '/api/dashboard' | '/api/report' | '/api/inquiry';

export interface ReviewPromptDefinition {
  label: string;
  prompt: string;
  dataStoreName?: string;
  topic?: string;
}

export interface ReviewModeDefinition {
  endpoint: ReviewEndpoint;
  label: string;
  description: string;
  placeholder: string;
  prompts: ReviewPromptDefinition[];
}

export const reviewModeShells: ReviewModeDefinition[] = [
  {
    endpoint: '/api/dashboard',
    label: 'لوحة المعلومات',
    description: 'إجابات مرئية بمخطط واحد لطلبات المقارنة والاتجاهات ومؤشرات الأداء.',
    placeholder: 'اكتب سؤالاً للوحة المعلومات',
    prompts: [],
  },
  {
    endpoint: '/api/report',
    label: 'التقرير',
    description: 'تحليل سردي مع مخططات داعمة عند الحاجة.',
    placeholder: 'اكتب طلب تقرير',
    prompts: [],
  },
  {
    endpoint: '/api/inquiry',
    label: 'الاستعلام',
    description: 'بحث سريع في السجلات مع ملخص نصي وروابط مباشرة للعناصر.',
    placeholder: 'اكتب سؤال بحث أو استعلام',
    prompts: [],
  },
];

export const capabilityMatrix = {
  done: [
    'تنسيق سير العمل عبر Mastra',
    'وكيل MongoDB للاستعلامات التحليلية وبناء aggregation آمن',
    'أدوار المشرف والبحث والكاتب والمخططات',
    'واجهات لوحة المعلومات والتقرير والاستعلام',
    'مسار رسم حتمي وآمن للمخططات',
  ],
  partial: [
    'مزودات الإثراء الخارجية',
    'تحسينات إضافية لوكيل المخططات فوق المسار الحتمي',
    'مرحلة مشتركة للدمج والتطبيع',
    'تنسيق متوازٍ للمهام المستقلة',
  ],
  missing: [
    'بوابة NestJS ومساحة عمل Nx',
    'قشرة تطبيق Angular',
    'بث التقدم مباشرة إلى الواجهة',
    'نطاق صلاحيات محقون عبر المصادقة',
    'بحث متجهي داخلي وخرائط جغرافية مهيأة',
    'عمليات MongoDB للإنشاء والتحديث والربط خارج نطاق خدمة التحليلات الحالية',
  ],
};
