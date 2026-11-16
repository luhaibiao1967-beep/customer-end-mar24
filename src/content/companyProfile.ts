import type { Language } from '../contexts/LanguageContext';

interface CompanyProfile {
  pageTitle: string;
  eyebrow: string;
  headline: string;
  introduction: string;
  order: string;
  discover: string;
  heroAlt: string;
  pillars: [string, string, string];
  aboutLabel: string;
  aboutTitle: string;
  aboutBody: string;
  mission: string;
  servicesLabel: string;
  servicesTitle: string;
  services: { title: string; body: string }[];
  galleryLabel: string;
  galleryTitle: string;
  galleryBody: string;
  galleryAlt: string;
  contactLabel: string;
  contactTitle: string;
  contactBody: string;
  phoneLabel: string;
  addressLabel: string;
  back: string;
}

// Editorial introduction based on the supplied company profiles. Keep business
// pricing, medical claims, franchise terms and future traceability out of this page.
export const companyContact = {
  phone: '+62 811-1000-4000',
  phoneHref: 'tel:+6281110004000',
  address: 'TCC Batavia Tower One, 5F No. 02, Jl. KH Mas Mansyur, Central Jakarta 10220, Indonesia',
};

export const companyProfiles: Record<Language, CompanyProfile> = {
  zh: {
    pageTitle: '公司介绍',
    eyebrow: '就在您身边的水工坊',
    headline: '日常好水，\n就在身边。',
    introduction: 'VIVIDAQUA 微微水工坊，将净水技术、社区门店与便捷订水服务相结合，为家庭、办公场所和社区提供日常饮用水。',
    order: '开始订水',
    discover: '了解 VIVIDAQUA',
    heroAlt: 'VIVIDAQUA 品牌吉祥物与桶装水',
    pillars: ['社区水工坊', '补水与重复使用', '便捷线上订购'],
    aboutLabel: '认识我们',
    aboutTitle: '让饮用水服务，\n融入每一天的生活。',
    aboutBody: 'VIVIDAQUA 是一家立足印度尼西亚的饮用水零售品牌。我们通过社区水工坊，将净水、自动灌装与数字化服务相结合，服务居家、工作和学习等日常用水场景。',
    mission: '我们的目标很简单：让客户能够便捷地获取就近制备的饮用水，并通过可重复使用的水桶和本地服务，让日常订水更省心。',
    servicesLabel: '我们的服务',
    servicesTitle: '从水工坊，到您的日常。',
    services: [
      { title: '就近制水', body: '依托社区水工坊，在门店完成净水与自动灌装，服务周边客户的日常用水需求。' },
      { title: '便捷订购', body: '通过客户端选择商品与配送日期，查看订单和配送进度，让订水安排更清晰。' },
      { title: '循环使用', body: '采用可重复使用的 19 升水桶，支持日常补水与换桶，让水桶持续发挥价值。' },
    ],
    galleryLabel: '身边的 VIVIDAQUA',
    galleryTitle: '与社区，一起成长。',
    galleryBody: '走近我们的门店与团队，了解 VIVIDAQUA 在社区中的服务日常。',
    galleryAlt: 'VIVIDAQUA 社区门店与服务团队',
    contactLabel: '联系我们',
    contactTitle: '想进一步了解我们？',
    contactBody: '欢迎联系总部，了解品牌与服务信息。具体商品、价格及配送安排请以客户端和服务网点信息为准。',
    phoneLabel: '总部咨询',
    addressLabel: '总部地址',
    back: '返回',
  },
  en: {
    pageTitle: 'Company introduction',
    eyebrow: 'YOUR NEIGHBOURHOOD WATER WORKSHOP',
    headline: 'Everyday water.\nCloser to home.',
    introduction: 'VIVIDAQUA brings water purification, local workshops and convenient ordering together for homes, workplaces and communities.',
    order: 'Order water',
    discover: 'Meet VIVIDAQUA',
    heroAlt: 'VIVIDAQUA mascot with a refill water gallon',
    pillars: ['Local workshops', 'Refill and reuse', 'Digital ordering'],
    aboutLabel: 'ABOUT US',
    aboutTitle: 'Water, made part of\nyour everyday life.',
    aboutBody: 'VIVIDAQUA is a drinking-water retail brand based in Indonesia. Through a network of local workshops, we combine water purification, automated filling and digital services to serve daily drinking-water needs at home, at work and in the community.',
    mission: 'Our aim is simple: convenient access to locally prepared drinking water, with reusable gallons and local service that make everyday ordering easier.',
    servicesLabel: 'WHAT WE DO',
    servicesTitle: 'From our workshops to your day.',
    services: [
      { title: 'Made nearby', body: 'Our community workshops combine water purification and automated filling to serve customers in their neighbourhoods.' },
      { title: 'Easy to order', body: 'Choose products and a delivery date in the app, then follow your orders and deliveries in one place.' },
      { title: 'Refill and reuse', body: 'Reusable 19-litre gallons support everyday refills and gallon exchanges, keeping each container in use.' },
    ],
    galleryLabel: 'IN YOUR COMMUNITY',
    galleryTitle: 'Growing with our neighbourhoods.',
    galleryBody: 'Meet some of the workshops and teams that bring VIVIDAQUA into everyday community life.',
    galleryAlt: 'VIVIDAQUA community workshop and service team',
    contactLabel: 'GET IN TOUCH',
    contactTitle: 'Want to know more?',
    contactBody: 'Contact our headquarters for information about VIVIDAQUA and our services. Check the app and your service branch for current products, prices and delivery arrangements.',
    phoneLabel: 'General enquiries',
    addressLabel: 'Headquarters',
    back: 'Back',
  },
  id: {
    pageTitle: 'Profil perusahaan',
    eyebrow: 'WORKSHOP AIR DI SEKITAR ANDA',
    headline: 'Air untuk keseharian.\nLebih dekat dengan Anda.',
    introduction: 'VIVIDAQUA memadukan teknologi pemurnian air, workshop lokal, dan pemesanan praktis untuk rumah, tempat kerja, serta komunitas.',
    order: 'Pesan air',
    discover: 'Kenali VIVIDAQUA',
    heroAlt: 'Maskot VIVIDAQUA dengan galon air isi ulang',
    pillars: ['Workshop lokal', 'Isi ulang dan pakai kembali', 'Pemesanan digital'],
    aboutLabel: 'TENTANG KAMI',
    aboutTitle: 'Layanan air untuk\nkehidupan sehari-hari.',
    aboutBody: 'VIVIDAQUA adalah merek ritel air minum yang berbasis di Indonesia. Melalui jaringan workshop lokal, kami menggabungkan pemurnian air, pengisian otomatis, dan layanan digital untuk kebutuhan air minum di rumah, tempat kerja, serta lingkungan sekitar.',
    mission: 'Tujuan kami sederhana: memudahkan akses ke air minum yang diproduksi di sekitar pelanggan, dengan galon yang dapat digunakan kembali dan layanan lokal yang praktis.',
    servicesLabel: 'LAYANAN KAMI',
    servicesTitle: 'Dari workshop untuk keseharian Anda.',
    services: [
      { title: 'Diproduksi di sekitar Anda', body: 'Workshop komunitas kami memadukan pemurnian air dan pengisian otomatis untuk melayani kebutuhan pelanggan di lingkungan sekitar.' },
      { title: 'Mudah dipesan', body: 'Pilih produk dan tanggal pengiriman melalui aplikasi, lalu pantau pesanan serta pengiriman dalam satu tempat.' },
      { title: 'Isi ulang dan pakai kembali', body: 'Galon 19 liter yang dapat digunakan kembali mendukung isi ulang dan penukaran galon untuk kebutuhan sehari-hari.' },
    ],
    galleryLabel: 'BERSAMA KOMUNITAS',
    galleryTitle: 'Tumbuh bersama lingkungan sekitar.',
    galleryBody: 'Kenali workshop dan tim yang menghadirkan VIVIDAQUA dalam keseharian komunitas.',
    galleryAlt: 'Workshop komunitas dan tim layanan VIVIDAQUA',
    contactLabel: 'HUBUNGI KAMI',
    contactTitle: 'Ingin mengenal kami lebih dekat?',
    contactBody: 'Hubungi kantor pusat untuk informasi mengenai VIVIDAQUA dan layanan kami. Produk, harga, dan pengaturan pengiriman terbaru dapat dilihat melalui aplikasi serta cabang layanan Anda.',
    phoneLabel: 'Informasi umum',
    addressLabel: 'Kantor pusat',
    back: 'Kembali',
  },
};
